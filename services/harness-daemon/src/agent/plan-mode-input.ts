import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { parseAgentLoopPlan, type AgentLoopPlan } from "./agent-loop-plan.js";

export const PLAN_DRAFT_INPUT_KEY = "planDraft";
export const PLAN_ACCEPT_INPUT_KEY = "planAccept";

export type PlanModeStep = {
  stepId: string;
  label: string;
};

export type PlanDraftArtifact = {
  planId: string;
  title: string;
  steps: PlanModeStep[];
};

export type PlanAcceptPayload = PlanDraftArtifact;

export type PlanAcceptBundle = {
  accept: PlanAcceptPayload;
  agentLoop: AgentLoopPlan;
};

function invalidPlanModeInput(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStep(raw: unknown): PlanModeStep {
  if (typeof raw !== "object" || raw === null) {
    invalidPlanModeInput("Passo inválido no plano.");
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.stepId) || !isNonEmptyString(record.label)) {
    invalidPlanModeInput("Passo exige stepId e label.");
  }
  return {
    stepId: record.stepId.trim(),
    label: record.label.trim(),
  };
}

function parsePlanArtifact(raw: unknown, contextLabel: string): PlanDraftArtifact {
  if (typeof raw !== "object" || raw === null) {
    invalidPlanModeInput(`${contextLabel} inválido.`);
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.planId) || !isNonEmptyString(record.title)) {
    invalidPlanModeInput(`${contextLabel} exige planId e title.`);
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    invalidPlanModeInput(`${contextLabel} exige steps não vazios.`);
  }
  return {
    planId: record.planId.trim(),
    title: record.title.trim(),
    steps: record.steps.map(parseStep),
  };
}

export function parsePlanDraft(raw: unknown): PlanDraftArtifact {
  return parsePlanArtifact(raw, "planDraft");
}

export function parsePlanAccept(raw: unknown, agentLoop: AgentLoopPlan): PlanAcceptPayload {
  const accept = parsePlanArtifact(raw, "planAccept");
  if (accept.steps.length !== agentLoop.turns.length) {
    invalidPlanModeInput(
      "planAccept.steps deve ter o mesmo número de turnos do agentLoop.",
      [String(accept.steps.length), String(agentLoop.turns.length)],
    );
  }
  return accept;
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

export function tryExtractPlanDraftFromUserText(text: string | undefined): PlanDraftArtifact | null {
  const envelope = parseUserInputEnvelope(text);
  if (!envelope || !(PLAN_DRAFT_INPUT_KEY in envelope)) {
    return null;
  }
  return parsePlanDraft(envelope[PLAN_DRAFT_INPUT_KEY]);
}

export function tryExtractPlanAcceptBundleFromUserText(
  text: string | undefined,
): PlanAcceptBundle | null {
  const envelope = parseUserInputEnvelope(text);
  if (!envelope || !(PLAN_ACCEPT_INPUT_KEY in envelope)) {
    return null;
  }
  if (!("agentLoop" in envelope)) {
    invalidPlanModeInput("planAccept exige agentLoop no mesmo envelope.");
  }
  const agentLoop = parseAgentLoopPlan(envelope.agentLoop);
  const accept = parsePlanAccept(envelope[PLAN_ACCEPT_INPUT_KEY], agentLoop);
  return { accept, agentLoop };
}
