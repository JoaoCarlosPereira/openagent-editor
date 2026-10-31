import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { parseAskLoopPlan, type AskLoopPlan } from "./ask-loop-plan.js";

export const DEBUG_SESSION_INPUT_KEY = "debugSession";

export type DebugVerificationOutcome = "confirmed" | "rejected";

export type DebugVerification = {
  outcome: DebugVerificationOutcome;
  summary: string;
};

export type DebugSessionBundle = {
  hypothesis: string;
  evidence: AskLoopPlan;
  verification: DebugVerification;
};

function invalidDebugInput(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseVerification(raw: unknown): DebugVerification {
  if (typeof raw !== "object" || raw === null) {
    invalidDebugInput("verification inválida no debugSession.");
  }
  const record = raw as Record<string, unknown>;
  const outcome = record.outcome;
  if (outcome !== "confirmed" && outcome !== "rejected") {
    invalidDebugInput("verification.outcome deve ser confirmed ou rejected.");
  }
  if (!isNonEmptyString(record.summary)) {
    invalidDebugInput("verification exige summary não vazio.");
  }
  return {
    outcome,
    summary: record.summary.trim(),
  };
}

export function parseDebugSession(raw: unknown): DebugSessionBundle {
  if (typeof raw !== "object" || raw === null) {
    invalidDebugInput("debugSession inválido.");
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.hypothesis)) {
    invalidDebugInput("debugSession exige hypothesis não vazia.");
  }
  if (!("evidence" in record)) {
    invalidDebugInput("debugSession exige evidence.");
  }
  if (!("verification" in record)) {
    invalidDebugInput("debugSession exige verification.");
  }
  return {
    hypothesis: record.hypothesis.trim(),
    evidence: parseAskLoopPlan(record.evidence),
    verification: parseVerification(record.verification),
  };
}

function parseUserInputEnvelope(text: string | undefined): Record<string, unknown> | null {
  if (!text || !text.trim().startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function tryExtractDebugSessionFromUserText(
  text: string | undefined,
): DebugSessionBundle | null {
  const envelope = parseUserInputEnvelope(text);
  if (!envelope || !(DEBUG_SESSION_INPUT_KEY in envelope)) {
    return null;
  }
  return parseDebugSession(envelope[DEBUG_SESSION_INPUT_KEY]);
}
