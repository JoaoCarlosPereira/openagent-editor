import type { CompletionKind, CompletionState } from "./rpc-methods.js";

/** Prazo observável PER-02: estado terminal Cancelada em até 2 s após o pedido. */
export const COMPLETION_CANCEL_DEADLINE_MS = 2000;

/** Tipos de HarnessEvent emitidos pelo serviço de completion do daemon (TAB-01). */
export const COMPLETION_EVENT_TYPE = {
  STARTED: "completion.started",
  DELTA: "completion.delta",
  COMPLETED: "completion.completed",
  CANCELLED: "completion.cancelled",
  INCOMPLETE: "completion.incomplete",
} as const;

export type CompletionEventType =
  (typeof COMPLETION_EVENT_TYPE)[keyof typeof COMPLETION_EVENT_TYPE];

const COMPLETION_EVENT_TYPES: readonly string[] = Object.values(COMPLETION_EVENT_TYPE);

export function isCompletionEventType(value: unknown): value is CompletionEventType {
  return typeof value === "string" && COMPLETION_EVENT_TYPES.includes(value);
}

export interface CompletionStartedPayload {
  type: typeof COMPLETION_EVENT_TYPE.STARTED;
  completionId: string;
  attempt: number;
  kind: CompletionKind;
  language?: string;
  /** SHA-256 da entrada; detecta reuso do mesmo completionId com outra entrada. */
  inputHash: string;
  /** Tamanho do texto já persistido de tentativas anteriores (retry idempotente). */
  resumeOffset: number;
}

export interface CompletionDeltaPayload {
  type: typeof COMPLETION_EVENT_TYPE.DELTA;
  completionId: string;
  attempt: number;
  /** Posição do primeiro caractere de `deltaText` no texto final; permite descartar duplicatas. */
  offset: number;
  deltaText: string;
}

export interface CompletionCompletedPayload {
  type: typeof COMPLETION_EVENT_TYPE.COMPLETED;
  completionId: string;
  attempt: number;
  text: string;
}

export interface CompletionCancelledPayload {
  type: typeof COMPLETION_EVENT_TYPE.CANCELLED;
  completionId: string;
  attempt: number;
  /** Texto parcial já gerado e preservado no cancelamento. */
  text: string;
}

export interface CompletionIncompletePayload {
  type: typeof COMPLETION_EVENT_TYPE.INCOMPLETE;
  completionId: string;
  attempt: number;
  text: string;
  /** Código estável (INCOMPLETE_STREAM ou PROVIDER_*). */
  code: string;
  reason: string;
  idempotentRetry: true;
  skipRepeatedMutations: true;
}

export type CompletionEventPayload =
  | CompletionStartedPayload
  | CompletionDeltaPayload
  | CompletionCompletedPayload
  | CompletionCancelledPayload
  | CompletionIncompletePayload;

export type CompletionTerminalState = Exclude<CompletionState, "running">;

export type CompletionPayloadValidation =
  | { valid: true; value: CompletionEventPayload }
  | { valid: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Valida o payload de um evento `completion.*` recebido do daemon. */
export function validateCompletionEventPayload(raw: unknown): CompletionPayloadValidation {
  if (!isRecord(raw)) {
    return { valid: false, errors: ["Payload de completion deve ser um objeto."] };
  }
  const errors: string[] = [];
  if (!isCompletionEventType(raw["type"])) {
    errors.push("Campo 'type' ausente ou fora do catálogo de completion.");
  }
  if (!isNonEmptyString(raw["completionId"])) {
    errors.push("Campo 'completionId' ausente ou inválido.");
  }
  if (!isNonNegativeInteger(raw["attempt"]) || raw["attempt"] < 1) {
    errors.push("Campo 'attempt' deve ser inteiro >= 1.");
  }
  switch (raw["type"]) {
    case COMPLETION_EVENT_TYPE.STARTED:
      if (!isNonNegativeInteger(raw["resumeOffset"])) {
        errors.push("Campo 'resumeOffset' deve ser inteiro >= 0.");
      }
      if (raw["kind"] !== "line" && raw["kind"] !== "block") {
        errors.push("Campo 'kind' deve ser 'line' ou 'block'.");
      }
      if (!isNonEmptyString(raw["inputHash"])) {
        errors.push("Campo 'inputHash' ausente ou inválido.");
      }
      break;
    case COMPLETION_EVENT_TYPE.DELTA:
      if (!isNonNegativeInteger(raw["offset"])) {
        errors.push("Campo 'offset' deve ser inteiro >= 0.");
      }
      if (typeof raw["deltaText"] !== "string" || raw["deltaText"].length === 0) {
        errors.push("Campo 'deltaText' deve ser string não-vazia.");
      }
      break;
    case COMPLETION_EVENT_TYPE.COMPLETED:
    case COMPLETION_EVENT_TYPE.CANCELLED:
      if (typeof raw["text"] !== "string") {
        errors.push("Campo 'text' deve ser string.");
      }
      break;
    case COMPLETION_EVENT_TYPE.INCOMPLETE:
      if (typeof raw["text"] !== "string") {
        errors.push("Campo 'text' deve ser string.");
      }
      if (!isNonEmptyString(raw["code"])) {
        errors.push("Campo 'code' ausente ou inválido.");
      }
      break;
    default:
      break;
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, value: raw as unknown as CompletionEventPayload };
}
