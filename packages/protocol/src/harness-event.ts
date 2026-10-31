import { ProtocolError } from "./errors.js";

/** Versão do schema de payload de eventos do harness (TechSpec — modelo Event). */
export const HARNESS_EVENT_SCHEMA_VERSION = 1 as const;

/**
 * Campos de um HarnessEvent conforme TechSpec (sequence, runId, type, schemaVersion,
 * payloadRef, timestamp). Eventos são append-only e ordenados por sequence.
 */
export interface HarnessEvent {
  sequence: number;
  runId: string;
  type: string;
  schemaVersion: typeof HARNESS_EVENT_SCHEMA_VERSION;
  payloadRef: string;
  timestamp: number;
}

export type HarnessEventValidationResult =
  | {
      valid: true;
      value: HarnessEvent;
    }
  | {
      valid: false;
      code: "INVALID_STATE";
      errors: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidSequence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    Number.isFinite(value)
  );
}

function isValidSchemaVersion(value: unknown): value is typeof HARNESS_EVENT_SCHEMA_VERSION {
  return value === HARNESS_EVENT_SCHEMA_VERSION;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateHarnessEvent(raw: unknown): HarnessEventValidationResult {
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["HarnessEvent deve ser um objeto JSON não-nulo."],
    };
  }

  if (!isValidSequence(raw["sequence"])) {
    errors.push(
      "Campo obrigatório 'sequence' ausente ou inválido (deve ser inteiro >= 1).",
    );
  }

  if (!isNonEmptyString(raw["runId"])) {
    errors.push("Campo obrigatório 'runId' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isNonEmptyString(raw["type"])) {
    errors.push("Campo obrigatório 'type' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isValidSchemaVersion(raw["schemaVersion"])) {
    errors.push(
      `Campo obrigatório 'schemaVersion' deve ser ${HARNESS_EVENT_SCHEMA_VERSION}.`,
    );
  }

  if (!isNonEmptyString(raw["payloadRef"])) {
    errors.push(
      "Campo obrigatório 'payloadRef' ausente ou inválido (deve ser string não-vazia).",
    );
  }

  if (!isValidTimestamp(raw["timestamp"])) {
    errors.push("Campo obrigatório 'timestamp' ausente ou inválido (deve ser número finito).");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors,
    };
  }

  return {
    valid: true,
    value: raw as unknown as HarnessEvent,
  };
}

export function assertHarnessEvent(raw: unknown): asserts raw is HarnessEvent {
  const result = validateHarnessEvent(raw);
  if (!result.valid) {
    throw new ProtocolError(
      result.code,
      `HarnessEvent inválido: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
}

/**
 * Valida uma sequência de eventos para replay ordenado (append-only).
 * Exige sequence estritamente crescente, sem duplicatas.
 */
export function validateHarnessEventStream(
  rawEvents: unknown,
): HarnessEventValidationResult & { events?: HarnessEvent[] } {
  if (!Array.isArray(rawEvents)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Stream de HarnessEvent deve ser um array."],
    };
  }

  const events: HarnessEvent[] = [];
  let lastSequence = 0;

  for (let index = 0; index < rawEvents.length; index += 1) {
    const itemResult = validateHarnessEvent(rawEvents[index]);
    if (!itemResult.valid) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: itemResult.errors.map((msg) => `evento[${index}]: ${msg}`),
      };
    }

    if (itemResult.value.sequence <= lastSequence) {
      return {
        valid: false,
        code: "INVALID_STATE",
        errors: [
          `evento[${index}]: sequence ${itemResult.value.sequence} deve ser maior que ${lastSequence}.`,
        ],
      };
    }

    lastSequence = itemResult.value.sequence;
    events.push(itemResult.value);
  }

  const last = events.at(-1);
  if (!last) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Stream de HarnessEvent não pode ser vazio."],
    };
  }

  return { valid: true, value: last, events };
}
