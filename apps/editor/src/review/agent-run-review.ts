import {
  describeCapabilityAction,
  formatPolicyTargetDisplay,
  validatePolicyCapability,
  validatePolicyTarget,
} from "@openagent/policy";
import {
  HarnessEventStreamController,
  ProtocolError,
  validateHarnessEvent,
} from "@openagent/protocol";

import {
  buildAgentRunReviewView,
  type AgentRunReviewViewSnapshot,
  type AgentToolResultRow,
} from "./agent-run-review-view.js";

export type { AgentRunReviewViewSnapshot, AgentToolResultRow } from "./agent-run-review-view.js";
export { buildAgentRunReviewView } from "./agent-run-review-view.js";

export interface ToolResultEventPayload {
  runId: string;
  invocation: {
    id: string;
    tool: string;
    target: string;
    capability: string;
    state: string;
    resultRef?: string | null;
  };
}

export interface DiffGroupedEventPayload {
  runId: string;
  groupedDiff: string;
  fileCount: number;
}

export interface AgentRunReviewPushInput {
  event: unknown;
  payload: unknown;
  /** Corpo CAS `{ kind: "tool_result", result }` quando disponível. */
  resolvedToolResult?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError("INVALID_STATE", `Campo '${field}' inválido no payload.`, [field]);
  }
  return value.trim();
}

function parseToolResultPayload(raw: unknown, expectedRunId: string): ToolResultEventPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload tool.result inválido.", ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  if (!isRecord(raw.invocation)) {
    throw new ProtocolError("INVALID_STATE", "Payload tool.result sem invocation.", ["invocation"]);
  }
  const inv = raw.invocation;
  return {
    runId,
    invocation: {
      id: requireNonEmptyString(inv.id, "invocation.id"),
      tool: requireNonEmptyString(inv.tool, "invocation.tool"),
      target: requireNonEmptyString(inv.target, "invocation.target"),
      capability: requireNonEmptyString(inv.capability, "invocation.capability"),
      state: requireNonEmptyString(inv.state, "invocation.state"),
      resultRef:
        inv.resultRef === null || inv.resultRef === undefined
          ? null
          : requireNonEmptyString(inv.resultRef, "invocation.resultRef"),
    },
  };
}

function parseDiffGroupedPayload(raw: unknown, expectedRunId: string): DiffGroupedEventPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload diff.grouped inválido.", ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  const groupedDiff = requireNonEmptyString(raw.groupedDiff, "groupedDiff");
  const fileCount = raw.fileCount;
  if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 0) {
    throw new ProtocolError("INVALID_STATE", "fileCount inválido em diff.grouped.", ["fileCount"]);
  }
  return { runId, groupedDiff, fileCount };
}

function extractResolvedResultBody(resolved: unknown): unknown {
  if (!isRecord(resolved)) {
    return undefined;
  }
  if (resolved.kind === "tool_result" && "result" in resolved) {
    return resolved.result;
  }
  return resolved.result ?? resolved;
}

function summarizeToolResult(tool: string, result: unknown): { summary: string; detail: string } {
  if (!isRecord(result)) {
    return { summary: "—", detail: "" };
  }
  if (tool === "shell.exec") {
    const exitCode = result.exitCode;
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const detail = stdout || stderr;
    return {
      summary: `exit ${exitCode === null || exitCode === undefined ? "?" : String(exitCode)}`,
      detail: detail.slice(0, 500),
    };
  }
  if (tool === "file.write") {
    const applied =
      typeof result.appliedCount === "number" ? result.appliedCount : undefined;
    const conflicts =
      typeof result.conflictCount === "number" ? result.conflictCount : undefined;
    const parts: string[] = [];
    if (conflicts && conflicts > 0) {
      parts.push(`${conflicts} conflito(s)`);
    }
    return {
      summary: applied !== undefined ? `${applied} arquivo(s)` : "gravação",
      detail: parts.join(" "),
    };
  }
  return { summary: "concluído", detail: "" };
}

function formatTargetForTool(tool: string, target: string): string {
  if (tool === "shell.exec") {
    const parsed = validatePolicyTarget({ kind: "command", command: target });
    if (parsed.valid) {
      return formatPolicyTargetDisplay(parsed.value);
    }
    return target;
  }
  const pathTarget = validatePolicyTarget({ kind: "path", path: target });
  if (pathTarget.valid) {
    return formatPolicyTargetDisplay(pathTarget.value);
  }
  return target;
}

function buildToolResultRow(
  payload: ToolResultEventPayload,
  resolvedToolResult: unknown | undefined,
): AgentToolResultRow {
  const capabilityResult = validatePolicyCapability(payload.invocation.capability);
  const action = capabilityResult.valid
    ? describeCapabilityAction(capabilityResult.value)
    : payload.invocation.capability;
  const resultBody = extractResolvedResultBody(resolvedToolResult);
  const { summary, detail } = summarizeToolResult(payload.invocation.tool, resultBody);
  return {
    invocationId: payload.invocation.id,
    tool: payload.invocation.tool,
    action,
    target: formatTargetForTool(payload.invocation.tool, payload.invocation.target),
    state: payload.invocation.state,
    summary,
    detail,
  };
}

/**
 * AGT-03: consome eventos tool.result e diff.grouped e monta a revisão agrupada.
 */
export class AgentRunReviewController {
  private readonly stream: HarnessEventStreamController;
  private groupedDiff = "";
  private fileCount: number | null = null;
  private readonly toolResults: AgentToolResultRow[] = [];
  private view: AgentRunReviewViewSnapshot;

  constructor(runId: string) {
    this.stream = new HarnessEventStreamController({ runId });
    this.view = buildAgentRunReviewView({ toolResults: [] });
  }

  get runId(): string {
    return this.stream.runId;
  }

  get snapshot(): AgentRunReviewViewSnapshot {
    return this.view;
  }

  push(input: AgentRunReviewPushInput): AgentRunReviewViewSnapshot {
    const eventCheck = validateHarnessEvent(input.event);
    if (!eventCheck.valid) {
      throw new ProtocolError("INVALID_STATE", "HarnessEvent inválido.", eventCheck.errors);
    }
    const event = eventCheck.value;
    if (event.runId !== this.runId) {
      throw new ProtocolError("INVALID_STATE", "runId do evento diverge do run monitorado.", [
        event.runId,
        this.runId,
      ]);
    }

    if (event.type === "tool.result") {
      const payload = parseToolResultPayload(input.payload, this.runId);
      const pushResult = this.stream.push(event);
      if (!pushResult.accepted) {
        throw new ProtocolError(pushResult.code, "Evento tool.result rejeitado pelo stream.", [
          ...(pushResult.code === "INVALID_STATE" ? pushResult.errors : []),
        ]);
      }
      this.toolResults.push(buildToolResultRow(payload, input.resolvedToolResult));
    } else if (event.type === "diff.grouped") {
      const payload = parseDiffGroupedPayload(input.payload, this.runId);
      const pushResult = this.stream.push(event);
      if (!pushResult.accepted) {
        throw new ProtocolError(pushResult.code, "Evento diff.grouped rejeitado pelo stream.", [
          ...(pushResult.code === "INVALID_STATE" ? pushResult.errors : []),
        ]);
      }
      this.groupedDiff = payload.groupedDiff;
      this.fileCount = payload.fileCount;
    } else {
      throw new ProtocolError("INVALID_STATE", "Tipo de evento não suportado na revisão do agente.", [
        event.type,
      ]);
    }

    this.view = buildAgentRunReviewView({
      groupedDiff: this.groupedDiff,
      ...(this.fileCount !== null ? { fileCount: this.fileCount } : {}),
      toolResults: this.toolResults,
    });
    return this.view;
  }

}
