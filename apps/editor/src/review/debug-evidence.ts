import {
  HarnessEventStreamController,
  ProtocolError,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  buildDebugEvidenceView,
  type DebugEvidencePhase,
  type DebugEvidenceViewSnapshot,
  type DebugVerificationOutcome,
} from "./debug-evidence-view.js";

export type {
  DebugEvidencePhase,
  DebugEvidenceViewSnapshot,
  DebugVerificationOutcome,
} from "./debug-evidence-view.js";
export { buildDebugEvidenceView } from "./debug-evidence-view.js";

export const DEBUG_HYPOTHESIS_EVENT = "debug.hypothesis";
export const DEBUG_EVIDENCE_EVENT = "debug.evidence";
export const DEBUG_VERIFICATION_EVENT = "debug.verification";

export interface DebugHypothesisPayload {
  runId: string;
  hypothesis: string;
  sessionId?: string;
}

export interface DebugEvidencePayload {
  runId: string;
  invocationIds: string[];
  toolResultCount: number;
  sessionId?: string;
}

export interface DebugVerificationPayload {
  runId: string;
  outcome: DebugVerificationOutcome;
  summary: string;
  sessionId?: string;
}

export interface DebugEvidencePushInput {
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

function parseHypothesisPayload(raw: unknown, expectedRunId: string): DebugHypothesisPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload debug.hypothesis inválido.", ["payload"]);
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
    hypothesis: requireNonEmptyString(raw.hypothesis, "hypothesis"),
    ...(typeof raw.sessionId === "string" && raw.sessionId.trim().length > 0
      ? { sessionId: raw.sessionId.trim() }
      : {}),
  };
}

function parseEvidencePayload(raw: unknown, expectedRunId: string): DebugEvidencePayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload debug.evidence inválido.", ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  if (!Array.isArray(raw.invocationIds)) {
    throw new ProtocolError("INVALID_STATE", "invocationIds inválido.", ["invocationIds"]);
  }
  const invocationIds = raw.invocationIds.map((id, index) =>
    requireNonEmptyString(id, `invocationIds[${index}]`),
  );
  const toolResultCount = raw.toolResultCount;
  if (
    typeof toolResultCount !== "number" ||
    !Number.isInteger(toolResultCount) ||
    toolResultCount < 0
  ) {
    throw new ProtocolError("INVALID_STATE", "toolResultCount inválido.", ["toolResultCount"]);
  }
  return {
    runId,
    invocationIds,
    toolResultCount,
    ...(typeof raw.sessionId === "string" && raw.sessionId.trim().length > 0
      ? { sessionId: raw.sessionId.trim() }
      : {}),
  };
}

function parseVerificationPayload(raw: unknown, expectedRunId: string): DebugVerificationPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload debug.verification inválido.", ["payload"]);
  }
  const runId = requireNonEmptyString(raw.runId, "runId");
  if (runId !== expectedRunId) {
    throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
      runId,
      expectedRunId,
    ]);
  }
  const outcome = raw.outcome;
  if (outcome !== "confirmed" && outcome !== "rejected") {
    throw new ProtocolError(
      "INVALID_STATE",
      "verification.outcome deve ser confirmed ou rejected.",
      ["outcome"],
    );
  }
  return {
    runId,
    outcome,
    summary: requireNonEmptyString(raw.summary, "summary"),
    ...(typeof raw.sessionId === "string" && raw.sessionId.trim().length > 0
      ? { sessionId: raw.sessionId.trim() }
      : {}),
  };
}

function emptyView(): DebugEvidenceViewSnapshot {
  return buildDebugEvidenceView({
    phase: "idle",
    hypothesis: "",
    invocationIds: [],
    toolResultCount: 0,
    verificationOutcome: null,
    verificationSummary: "",
  });
}

/**
 * AGT-04: consome debug.hypothesis / debug.evidence / debug.verification e monta o painel.
 * Só libera "concluir" após a verificação (fase verified).
 */
export class DebugEvidenceController {
  private readonly stream: HarnessEventStreamController;
  private phase: DebugEvidencePhase = "idle";
  private hypothesis = "";
  private invocationIds: string[] = [];
  private toolResultCount = 0;
  private verificationOutcome: DebugVerificationOutcome | null = null;
  private verificationSummary = "";
  private view: DebugEvidenceViewSnapshot;

  constructor(runId: string) {
    this.stream = new HarnessEventStreamController({ runId });
    this.view = emptyView();
  }

  get runId(): string {
    return this.stream.runId;
  }

  get snapshot(): DebugEvidenceViewSnapshot {
    return this.view;
  }

  push(input: DebugEvidencePushInput): DebugEvidenceViewSnapshot {
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

    if (event.type === DEBUG_HYPOTHESIS_EVENT) {
      const payload = parseHypothesisPayload(input.payload, this.runId);
      if (this.phase !== "idle") {
        throw new ProtocolError(
          "INVALID_STATE",
          "debug.hypothesis exige sessão idle antes da hipótese.",
          [this.phase],
        );
      }
      this.acceptStreamEvent(event, DEBUG_HYPOTHESIS_EVENT);
      this.hypothesis = payload.hypothesis;
      this.phase = "hypothesis";
      this.invocationIds = [];
      this.toolResultCount = 0;
      this.verificationOutcome = null;
      this.verificationSummary = "";
    } else if (event.type === DEBUG_EVIDENCE_EVENT) {
      const payload = parseEvidencePayload(input.payload, this.runId);
      if (this.phase !== "hypothesis") {
        throw new ProtocolError(
          "INVALID_STATE",
          "debug.evidence exige hipótese registrada antes da evidência.",
          [this.phase],
        );
      }
      this.acceptStreamEvent(event, DEBUG_EVIDENCE_EVENT);
      this.invocationIds = payload.invocationIds;
      this.toolResultCount = payload.toolResultCount;
      this.phase = "evidence";
    } else if (event.type === DEBUG_VERIFICATION_EVENT) {
      const payload = parseVerificationPayload(input.payload, this.runId);
      if (this.phase !== "evidence") {
        throw new ProtocolError(
          "INVALID_STATE",
          "debug.verification exige evidência registrada antes da verificação.",
          [this.phase],
        );
      }
      this.acceptStreamEvent(event, DEBUG_VERIFICATION_EVENT);
      this.verificationOutcome = payload.outcome;
      this.verificationSummary = payload.summary;
      this.phase = "verified";
    } else {
      throw new ProtocolError("INVALID_STATE", "Tipo de evento não suportado no painel Debug.", [
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

  private buildCurrentView(): DebugEvidenceViewSnapshot {
    if (this.phase === "idle") {
      return emptyView();
    }
    return buildDebugEvidenceView({
      phase: this.phase,
      hypothesis: this.hypothesis,
      invocationIds: this.invocationIds,
      toolResultCount: this.toolResultCount,
      verificationOutcome: this.verificationOutcome,
      verificationSummary: this.verificationSummary,
    });
  }
}
