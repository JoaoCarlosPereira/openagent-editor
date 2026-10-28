import {
  permissionDeniedError,
  ProtocolError,
  type HarnessEvent,
} from "@openagent/protocol";

import { type InMemoryGrantRegistry, type PermissionGrantContext } from "./grants.js";
import {
  createToolPermissionRequest,
  formatPermissionPromptForDisplay,
  mayExecuteAfterPermissionGate,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
  validateToolPermissionRequest,
  type CreateToolPermissionRequestInput,
} from "./permission-model.js";
import type {
  GrantScopeKind,
  PermissionDecision,
  PermissionExecutionGate,
  PermissionPrompt,
  ToolPermissionRequest,
} from "./types.js";

export const RUN_PERMISSION_REQUESTED_EVENT = "permission.requested";
export const RUN_PERMISSION_DECIDED_EVENT = "permission.decided";

export interface PermissionRequestedPayload {
  type: typeof RUN_PERMISSION_REQUESTED_EVENT;
  runId: string;
  sessionId: string;
  requestId: string;
  capability: string;
  prompt: PermissionPrompt;
  offeredScopes: readonly GrantScopeKind[];
}

export interface PermissionDecidedPayload {
  type: typeof RUN_PERMISSION_DECIDED_EVENT;
  runId: string;
  sessionId: string;
  requestId: string;
  decision: PermissionDecision;
  selectedScope: GrantScopeKind;
  canExecute: boolean;
}

export interface BeginRunToolPermissionInput {
  runId: unknown;
  sessionId: unknown;
  request: CreateToolPermissionRequestInput;
  preferredScope?: GrantScopeKind;
}

export type RunToolPermissionPrepareResult =
  | {
      phase: "granted";
      request: ToolPermissionRequest;
      canExecute: true;
    }
  | {
      phase: "pending";
      request: ToolPermissionRequest;
      gate: Extract<PermissionExecutionGate, { phase: "pending" }>;
      prompt: ReturnType<typeof formatPermissionPromptForDisplay>;
      canExecute: false;
    };

export interface RunPermissionEventWriter {
  putCasBlob(data: Buffer): { contentRef: string };
  appendHarnessEvent(input: {
    runId: string;
    type: string;
    payloadRef: string;
    timestamp: number;
  }): HarnessEvent;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRunContext(runId: unknown, sessionId: unknown): { runId: string; sessionId: string } {
  const errors: string[] = [];
  if (!isNonEmptyString(runId)) {
    errors.push("Campo 'runId' ausente ou inválido.");
  }
  if (!isNonEmptyString(sessionId)) {
    errors.push("Campo 'sessionId' ausente ou inválido.");
  }
  if (errors.length > 0) {
    throw new ProtocolError("INVALID_STATE", "Contexto de run inválido.", errors);
  }
  const normalizedRunId = (runId as string).trim();
  const normalizedSessionId = (sessionId as string).trim();
  return { runId: normalizedRunId, sessionId: normalizedSessionId };
}

export function prepareRunToolPermission(
  input: BeginRunToolPermissionInput,
  options?: {
    grants?: InMemoryGrantRegistry;
    grantContext?: PermissionGrantContext;
  },
): RunToolPermissionPrepareResult {
  validateRunContext(input.runId, input.sessionId);
  const request = createToolPermissionRequest(input.request);

  const registry = options?.grants;
  const grantContext = options?.grantContext;
  if (registry && grantContext) {
    const active = registry.findActiveGrant(request.capability, request.target, grantContext);
    if (active) {
      return { phase: "granted", request, canExecute: true };
    }
  }

  const gate = openPermissionExecutionGate(request, input.preferredScope);
  if (gate.phase !== "pending") {
    throw new ProtocolError("INVALID_STATE", "Gate de permissão inválido após abertura.");
  }

  return {
    phase: "pending",
    request,
    gate,
    prompt: formatPermissionPromptForDisplay(gate.prompt),
    canExecute: false,
  };
}

export function buildPermissionRequestedPayload(
  context: { runId: string; sessionId: string },
  request: ToolPermissionRequest,
  gate: Extract<PermissionExecutionGate, { phase: "pending" }>,
): PermissionRequestedPayload {
  return {
    type: RUN_PERMISSION_REQUESTED_EVENT,
    runId: context.runId,
    sessionId: context.sessionId,
    requestId: request.requestId,
    capability: request.capability,
    prompt: gate.prompt,
    offeredScopes: request.offeredScopes,
  };
}

export function buildPermissionDecidedPayload(
  context: { runId: string; sessionId: string },
  gate: PermissionExecutionGate,
): PermissionDecidedPayload {
  if (gate.phase !== "resolved") {
    throw new ProtocolError(
      "INVALID_STATE",
      "Evento permission.decided exige gate resolvido.",
      [`phase=${gate.phase}`],
    );
  }
  return {
    type: RUN_PERMISSION_DECIDED_EVENT,
    runId: context.runId,
    sessionId: context.sessionId,
    requestId: gate.request.requestId,
    decision: gate.decision,
    selectedScope: gate.selectedScope,
    canExecute: mayExecuteAfterPermissionGate(gate),
  };
}

export function persistHarnessEventWithPayload(
  writer: RunPermissionEventWriter,
  runId: string,
  type: string,
  payload: Record<string, unknown>,
  timestamp: number = Date.now(),
): HarnessEvent {
  const body = JSON.stringify(payload);
  const cas = writer.putCasBlob(Buffer.from(body, "utf8"));
  return writer.appendHarnessEvent({
    runId,
    type,
    payloadRef: cas.contentRef,
    timestamp,
  });
}

export function persistPermissionRequestedEvent(
  writer: RunPermissionEventWriter,
  context: { runId: string; sessionId: string },
  request: ToolPermissionRequest,
  gate: Extract<PermissionExecutionGate, { phase: "pending" }>,
  timestamp?: number,
): HarnessEvent {
  const payload = buildPermissionRequestedPayload(context, request, gate);
  return persistHarnessEventWithPayload(
    writer,
    context.runId,
    RUN_PERMISSION_REQUESTED_EVENT,
    payload as unknown as Record<string, unknown>,
    timestamp,
  );
}

export function persistPermissionDecidedEvent(
  writer: RunPermissionEventWriter,
  context: { runId: string; sessionId: string },
  gate: PermissionExecutionGate,
  timestamp?: number,
): HarnessEvent {
  const payload = buildPermissionDecidedPayload(context, gate);
  return persistHarnessEventWithPayload(
    writer,
    context.runId,
    RUN_PERMISSION_DECIDED_EVENT,
    payload as unknown as Record<string, unknown>,
    timestamp,
  );
}

export function resolveRunToolPermission(
  gate: Extract<PermissionExecutionGate, { phase: "pending" }>,
  decision: PermissionDecision,
  selectedScope: GrantScopeKind,
): PermissionExecutionGate {
  return resolvePermissionExecutionGate(gate, decision, selectedScope);
}

/** PER-01: execução de ferramenta no run só após aceite explícito. */
export function assertRunToolMayExecute(gate: PermissionExecutionGate): void {
  if (mayExecuteAfterPermissionGate(gate)) {
    return;
  }
  throw permissionDeniedError("Execução bloqueada até aceite explícito de permissão.", [
    `requestId=${gate.request.requestId}`,
    `phase=${gate.phase}`,
  ]);
}

export class RunToolPermissionFlow {
  private readonly pending = new Map<
    string,
    {
      gate: Extract<PermissionExecutionGate, { phase: "pending" }>;
      runId: string;
      sessionId: string;
      request: ToolPermissionRequest;
    }
  >();

  requestPermission(input: BeginRunToolPermissionInput): RunToolPermissionPrepareResult {
    const prepared = prepareRunToolPermission(input);
    if (prepared.phase === "granted") {
      return prepared;
    }
    const context = validateRunContext(input.runId, input.sessionId);
    this.pending.set(prepared.request.requestId, {
      gate: prepared.gate,
      runId: context.runId,
      sessionId: context.sessionId,
      request: prepared.request,
    });
    return prepared;
  }

  decide(
    requestId: string,
    decision: PermissionDecision,
    selectedScope: GrantScopeKind,
  ): { gate: PermissionExecutionGate; canExecute: boolean; context: { runId: string; sessionId: string } } {
    const pending = this.pending.get(requestId);
    if (!pending) {
      throw new ProtocolError(
        "INVALID_STATE",
        "Pedido de permissão não encontrado ou já decidido.",
        [`requestId=${requestId}`],
      );
    }
    const gate = resolveRunToolPermission(pending.gate, decision, selectedScope);
    this.pending.delete(requestId);
    return {
      gate,
      canExecute: mayExecuteAfterPermissionGate(gate),
      context: { runId: pending.runId, sessionId: pending.sessionId },
    };
  }

  getPending(requestId: string): ToolPermissionRequest | undefined {
    return this.pending.get(requestId)?.request;
  }
}

export function validateBeginRunToolPermissionInput(
  raw: BeginRunToolPermissionInput,
): ReturnType<typeof validateToolPermissionRequest> {
  const errors: string[] = [];
  if (!isNonEmptyString(raw.runId)) {
    errors.push("Campo 'runId' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw.sessionId)) {
    errors.push("Campo 'sessionId' ausente ou inválido.");
  }
  const requestResult = validateToolPermissionRequest(raw.request);
  if (!requestResult.valid) {
    errors.push(...requestResult.errors);
  }
  if (errors.length > 0 || !requestResult.valid) {
    return { valid: false, code: "INVALID_STATE", errors };
  }
  return requestResult;
}
