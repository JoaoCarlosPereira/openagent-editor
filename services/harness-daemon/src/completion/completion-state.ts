import {
  COMPLETION_EVENT_TYPE,
  isCompletionEventType,
  validateCompletionEventPayload,
  type CompletionEventPayload,
  type CompletionState,
  type HarnessEvent,
} from "@openagent/protocol";
import type { WorkspaceDatabase } from "@openagent/storage";

export type CompletionTerminal = {
  event: HarnessEvent;
  payload: CompletionEventPayload;
};

/** Estado de um completion reconstruído do log de eventos append-only (TechSpec: projeções reconstruíveis). */
export type CompletionSnapshot = {
  completionId: string;
  attempt: number;
  /** `running` aqui significa "sem terminal no log"; o chamador distingue ativo de interrompido. */
  state: CompletionState;
  text: string;
  inputHash: string;
  terminal?: CompletionTerminal;
};

/** Aplica um delta no texto acumulado respeitando o offset (deduplica retries). */
export function applyCompletionDelta(text: string, offset: number, deltaText: string): string {
  return text.slice(0, offset) + deltaText;
}

export function readCompletionSnapshot(
  db: WorkspaceDatabase,
  runId: string,
  completionId: string,
): CompletionSnapshot | undefined {
  let snapshot: CompletionSnapshot | undefined;
  for (const event of db.listHarnessEvents(runId)) {
    if (!isCompletionEventType(event.type)) {
      continue;
    }
    const validation = validateCompletionEventPayload(
      JSON.parse(Buffer.from(db.readCasBlob(event.payloadRef)).toString("utf8")) as unknown,
    );
    if (!validation.valid || validation.value.completionId !== completionId) {
      continue;
    }
    const payload = validation.value;
    switch (payload.type) {
      case COMPLETION_EVENT_TYPE.STARTED:
        snapshot = {
          completionId,
          attempt: payload.attempt,
          state: "running",
          text: snapshot?.text ?? "",
          inputHash: payload.inputHash,
        };
        break;
      case COMPLETION_EVENT_TYPE.DELTA:
        if (snapshot) {
          snapshot.text = applyCompletionDelta(snapshot.text, payload.offset, payload.deltaText);
        }
        break;
      case COMPLETION_EVENT_TYPE.COMPLETED:
      case COMPLETION_EVENT_TYPE.CANCELLED:
      case COMPLETION_EVENT_TYPE.INCOMPLETE:
        if (snapshot) {
          snapshot.state =
            payload.type === COMPLETION_EVENT_TYPE.COMPLETED
              ? "completed"
              : payload.type === COMPLETION_EVENT_TYPE.CANCELLED
                ? "cancelled"
                : "incomplete";
          snapshot.text = payload.text;
          snapshot.terminal = { event, payload };
        }
        break;
    }
  }
  return snapshot;
}
