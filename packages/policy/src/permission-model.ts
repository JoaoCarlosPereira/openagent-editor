import { ProtocolError } from "@openagent/protocol";

import { describeCapabilityAction, validatePolicyCapability } from "./capability.js";
import { formatGrantScopeLabel, validateOfferedScopes } from "./scope.js";
import { formatPolicyTargetDisplay, validatePolicyTarget } from "./target.js";
import type {
  GrantScopeKind,
  PermissionDecision,
  PermissionExecutionGate,
  PermissionPrompt,
  PolicyValidationResult,
  SandboxIsolationLevel,
  ToolPermissionRequest,
} from "./types.js";

function applyExecutionIsolationToPrompt(
  prompt: PermissionPrompt,
  isolation?: { level: SandboxIsolationLevel; degradationNotice?: string },
): PermissionPrompt {
  if (!isolation || isolation.level === "native") {
    return prompt;
  }
  const notice = isolation.degradationNotice?.trim();
  if (!notice) {
    return { ...prompt, sandboxIsolationLevel: "degraded" };
  }
  return {
    ...prompt,
    sandboxIsolationLevel: "degraded",
    degradationNotice: notice,
  };
}

function preserveSandboxPromptFields(
  next: PermissionPrompt,
  previous: PermissionPrompt,
): PermissionPrompt {
  if (previous.sandboxIsolationLevel !== "degraded") {
    return next;
  }
  return {
    ...next,
    sandboxIsolationLevel: previous.sandboxIsolationLevel,
    ...(previous.degradationNotice ? { degradationNotice: previous.degradationNotice } : {}),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface CreateToolPermissionRequestInput {
  requestId: unknown;
  capability: unknown;
  target: unknown;
  offeredScopes?: unknown;
}

export function buildPermissionPrompt(input: {
  capability: string;
  targetDisplay: string;
  scope: GrantScopeKind;
}): PermissionPrompt {
  return {
    action: describeCapabilityAction(input.capability),
    target: input.targetDisplay,
    scope: input.scope,
  };
}

export function validateToolPermissionRequest(
  raw: CreateToolPermissionRequestInput,
): PolicyValidationResult<ToolPermissionRequest> {
  const errors: string[] = [];

  if (!isNonEmptyString(raw.requestId)) {
    errors.push("Campo 'requestId' ausente ou inválido.");
  }

  const capabilityResult = validatePolicyCapability(raw.capability);
  if (!capabilityResult.valid) {
    errors.push(...capabilityResult.errors);
  }

  const targetResult = validatePolicyTarget(raw.target);
  if (!targetResult.valid) {
    errors.push(...targetResult.errors);
  }

  const scopesResult = validateOfferedScopes(raw.offeredScopes ?? ["once", "session", "workspace"]);
  if (!scopesResult.valid) {
    errors.push(...scopesResult.errors);
  }

  if (
    errors.length > 0 ||
    !capabilityResult.valid ||
    !targetResult.valid ||
    !scopesResult.valid ||
    !isNonEmptyString(raw.requestId)
  ) {
    return { valid: false, code: "INVALID_STATE", errors };
  }

  const request: ToolPermissionRequest = {
    requestId: raw.requestId.trim(),
    capability: capabilityResult.value,
    target: targetResult.value,
    offeredScopes: scopesResult.value,
  };

  return { valid: true, value: request };
}

export function createToolPermissionRequest(
  raw: CreateToolPermissionRequestInput,
): ToolPermissionRequest {
  const result = validateToolPermissionRequest(raw);
  if (!result.valid) {
    throw new ProtocolError("INVALID_STATE", "Pedido de permissão inválido.", result.errors);
  }
  return result.value;
}

export function openPermissionExecutionGate(
  request: ToolPermissionRequest,
  preferredScope: GrantScopeKind = request.offeredScopes[0] ?? "once",
  executionIsolation?: { level: SandboxIsolationLevel; degradationNotice?: string },
): PermissionExecutionGate {
  if (!request.offeredScopes.includes(preferredScope)) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Escopo preferido não está entre os escopos oferecidos.",
      [`preferredScope=${preferredScope}`],
    );
  }

  const prompt = applyExecutionIsolationToPrompt(
    buildPermissionPrompt({
      capability: request.capability,
      targetDisplay: formatPolicyTargetDisplay(request.target),
      scope: preferredScope,
    }),
    executionIsolation,
  );

  return { phase: "pending", request, prompt };
}

export function resolvePermissionExecutionGate(
  gate: PermissionExecutionGate,
  decision: PermissionDecision,
  selectedScope: GrantScopeKind,
): PermissionExecutionGate {
  if (gate.phase !== "pending") {
    throw new ProtocolError(
      "INVALID_STATE",
      "Pedido de permissão já foi decidido.",
      [`phase=${gate.phase}`],
    );
  }

  if (!gate.request.offeredScopes.includes(selectedScope)) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Escopo selecionado não está entre os escopos oferecidos.",
      [`selectedScope=${selectedScope}`],
    );
  }

  const prompt = preserveSandboxPromptFields(
    buildPermissionPrompt({
      capability: gate.request.capability,
      targetDisplay: formatPolicyTargetDisplay(gate.request.target),
      scope: selectedScope,
    }),
    gate.prompt,
  );

  return {
    phase: "resolved",
    request: gate.request,
    prompt,
    decision,
    selectedScope,
  };
}

/** PER-01: ferramenta só pode executar após aceite explícito (decision === allow). */
export function mayExecuteAfterPermissionGate(gate: PermissionExecutionGate): boolean {
  return gate.phase === "resolved" && gate.decision === "allow";
}

export function formatPermissionPromptForDisplay(prompt: PermissionPrompt): {
  action: string;
  target: string;
  scopeLabel: string;
  sandboxIsolationLevel?: SandboxIsolationLevel;
  degradationNotice?: string;
} {
  return {
    action: prompt.action,
    target: prompt.target,
    scopeLabel: formatGrantScopeLabel(prompt.scope),
    ...(prompt.sandboxIsolationLevel ? { sandboxIsolationLevel: prompt.sandboxIsolationLevel } : {}),
    ...(prompt.degradationNotice ? { degradationNotice: prompt.degradationNotice } : {}),
  };
}
