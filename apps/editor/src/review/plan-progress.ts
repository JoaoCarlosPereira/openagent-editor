import {
  HarnessEventStreamController,
  ProtocolError,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  buildPlanProgressView,
  type PlanProgressPhase,
  type PlanProgressStep,
  type PlanProgressViewSnapshot,
} from "./plan-progress-view.js";

export type { PlanProgressPhase, PlanProgressStep, PlanProgressViewSnapshot } from "./plan-progress-view.js";
export { buildPlanProgressView } from "./plan-progress-view.js";

export const PLAN_PRESENTED_EVENT = "plan.presented";
export const PLAN_ACCEPTED_EVENT = "plan.accepted";
export const PLAN_PROGRESS_EVENT = "plan.progress";

export interface PlanPresentedPayload {
  runId: string;
  planId: string;
  title: string;
  steps: PlanProgressStep[];
  sessionId?: string;
}

export interface PlanAcceptedPayload {
  runId: string;
  planId: string;
  title: string;
  steps: PlanProgressStep[];
  sessionId?: string;
}

export interface PlanProgressPayload {
  runId: string;
  planId: string;
  currentStepId: string;
  currentStepLabel: string;
  completedStepIds: string[];
  completedCount: number;
  totalSteps: number;
  progressRatio: number;
}

export interface PlanProgressPushInput {
  event: unknown;
  payload: unknown;
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

function parseSteps(raw: unknown): PlanProgressStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProtocolError("INVALID_STATE", "steps do plano deve ser uma lista não vazia.", [
      "steps",
    ]);
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      throw new ProtocolError("INVALID_STATE", "Passo do plano inválido.", [`steps[${index}]`]);
    }
    return {
      stepId: requireNonEmptyString(item.stepId, `steps[${index}].stepId`),
      label: requireNonEmptyString(item.label, `steps[${index}].label`),
    };
  });
}

function parsePlanArtifactPayload(
  raw: unknown,
  expectedRunId: string,
  label: string,
): PlanPresentedPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", `Payload ${label} inválido.`, ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  return {
    runId,
    planId: requireNonEmptyString(raw.planId, "planId"),
    title: requireNonEmptyString(raw.title, "title"),
    steps: parseSteps(raw.steps),
    ...(typeof raw.sessionId === "string" && raw.sessionId.trim().length > 0
      ? { sessionId: raw.sessionId.trim() }
      : {}),
  };
}

function parseProgressPayload(raw: unknown, expectedRunId: string): PlanProgressPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload plan.progress inválido.", ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  const completedStepIdsRaw = raw.completedStepIds;
  if (!Array.isArray(completedStepIdsRaw)) {
    throw new ProtocolError("INVALID_STATE", "completedStepIds inválido.", ["completedStepIds"]);
  }
  const completedStepIds = completedStepIdsRaw.map((id, index) =>
    requireNonEmptyString(id, `completedStepIds[${index}]`),
  );
  const completedCount = raw.completedCount;
  const totalSteps = raw.totalSteps;
  const progressRatio = raw.progressRatio;
  if (typeof completedCount !== "number" || !Number.isInteger(completedCount) || completedCount < 0) {
    throw new ProtocolError("INVALID_STATE", "completedCount inválido.", ["completedCount"]);
  }
  if (typeof totalSteps !== "number" || !Number.isInteger(totalSteps) || totalSteps < 1) {
    throw new ProtocolError("INVALID_STATE", "totalSteps inválido.", ["totalSteps"]);
  }
  if (typeof progressRatio !== "number" || Number.isNaN(progressRatio)) {
    throw new ProtocolError("INVALID_STATE", "progressRatio inválido.", ["progressRatio"]);
  }
  return {
    runId,
    planId: requireNonEmptyString(raw.planId, "planId"),
    currentStepId: requireNonEmptyString(raw.currentStepId, "currentStepId"),
    currentStepLabel: requireNonEmptyString(raw.currentStepLabel, "currentStepLabel"),
    completedStepIds,
    completedCount,
    totalSteps,
    progressRatio,
  };
}

function emptyView(): PlanProgressViewSnapshot {
  return buildPlanProgressView({
    planId: "",
    title: "",
    steps: [],
    phase: "idle",
  });
}

/**
 * AGT-02: consome plan.presented / plan.accepted / plan.progress e monta o painel visível.
 */
export class PlanProgressController {
  private readonly stream: HarnessEventStreamController;
  private planId = "";
  private title = "";
  private steps: PlanProgressStep[] = [];
  private phase: PlanProgressPhase = "idle";
  private currentStepId: string | null = null;
  private currentStepLabel: string | null = null;
  private completedStepIds: string[] = [];
  private completedCount = 0;
  private totalSteps = 0;
  private progressRatio = 0;
  private view: PlanProgressViewSnapshot;

  constructor(runId: string) {
    this.stream = new HarnessEventStreamController({ runId });
    this.view = emptyView();
  }

  get runId(): string {
    return this.stream.runId;
  }

  get snapshot(): PlanProgressViewSnapshot {
    return this.view;
  }

  push(input: PlanProgressPushInput): PlanProgressViewSnapshot {
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

    if (event.type === PLAN_PRESENTED_EVENT) {
      const payload = parsePlanArtifactPayload(input.payload, this.runId, PLAN_PRESENTED_EVENT);
      this.acceptStreamEvent(event, "plan.presented");
      this.planId = payload.planId;
      this.title = payload.title;
      this.steps = payload.steps;
      this.phase = "presented";
      this.currentStepId = null;
      this.currentStepLabel = null;
      this.completedStepIds = [];
      this.completedCount = 0;
      this.totalSteps = payload.steps.length;
      this.progressRatio = 0;
    } else if (event.type === PLAN_ACCEPTED_EVENT) {
      const payload = parsePlanArtifactPayload(input.payload, this.runId, PLAN_ACCEPTED_EVENT);
      this.acceptStreamEvent(event, "plan.accepted");
      if (this.phase === "idle") {
        this.planId = payload.planId;
        this.title = payload.title;
        this.steps = payload.steps;
        this.totalSteps = payload.steps.length;
      } else if (this.planId !== payload.planId) {
        throw new ProtocolError("INVALID_STATE", "planId do aceite diverge do plano apresentado.", [
          this.planId,
          payload.planId,
        ]);
      }
      this.phase = "accepted";
    } else if (event.type === PLAN_PROGRESS_EVENT) {
      const payload = parseProgressPayload(input.payload, this.runId);
      this.acceptStreamEvent(event, "plan.progress");
      if (this.phase === "idle" || this.phase === "presented") {
        throw new ProtocolError(
          "INVALID_STATE",
          "plan.progress exige plano aceito antes do progresso.",
          [this.phase],
        );
      }
      if (this.planId && this.planId !== payload.planId) {
        throw new ProtocolError("INVALID_STATE", "planId do progresso diverge do plano.", [
          this.planId,
          payload.planId,
        ]);
      }
      this.planId = payload.planId;
      this.currentStepId = payload.currentStepId;
      this.currentStepLabel = payload.currentStepLabel;
      this.completedStepIds = payload.completedStepIds;
      this.completedCount = payload.completedCount;
      this.totalSteps = payload.totalSteps;
      this.progressRatio = payload.progressRatio;
      this.phase =
        payload.completedCount >= payload.totalSteps && payload.totalSteps > 0
          ? "completed"
          : "executing";
    } else {
      throw new ProtocolError("INVALID_STATE", "Tipo de evento não suportado no painel Plan.", [
        event.type,
      ]);
    }

    this.view = this.buildCurrentView();
    return this.view;
  }

  private acceptStreamEvent(event: HarnessEvent, label: string): void {
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(pushResult.code, `Evento ${label} rejeitado pelo stream.`, [
        ...(pushResult.code === "INVALID_STATE" ? pushResult.errors : []),
      ]);
    }
  }

  private buildCurrentView(): PlanProgressViewSnapshot {
    if (this.phase === "idle") {
      return emptyView();
    }
    return buildPlanProgressView({
      planId: this.planId,
      title: this.title,
      steps: this.steps,
      phase: this.phase,
      currentStepId: this.currentStepId,
      currentStepLabel: this.currentStepLabel,
      completedStepIds: this.completedStepIds,
      completedCount: this.completedCount,
      totalSteps: this.totalSteps > 0 ? this.totalSteps : this.steps.length,
      progressRatio: this.progressRatio,
    });
  }
}
