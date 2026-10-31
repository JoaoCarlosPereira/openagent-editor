import { ProtocolError } from "./errors.js";
import type {
  EnvelopeValidationResult,
  MutableCommandEnvelope,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidExpectedVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

/**
 * Valida se um objeto qualquer atende estritamente à especificação de
 * MutableCommandEnvelope (requestId, workspaceId, sessionId, runId, expectedVersion, capability).
 */
export function validateMutableCommandEnvelope<T = unknown>(
  raw: unknown,
): EnvelopeValidationResult<T> {
  const errors: string[] = [];

  if (!isRecord(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["O envelope de comando deve ser um objeto JSON não-nulo."],
    };
  }

  if (!isNonEmptyString(raw["requestId"])) {
    errors.push("Campo obrigatório 'requestId' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isNonEmptyString(raw["workspaceId"])) {
    errors.push("Campo obrigatório 'workspaceId' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isNonEmptyString(raw["sessionId"])) {
    errors.push("Campo obrigatório 'sessionId' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isNonEmptyString(raw["runId"])) {
    errors.push("Campo obrigatório 'runId' ausente ou inválido (deve ser string não-vazia).");
  }

  if (!isValidExpectedVersion(raw["expectedVersion"])) {
    errors.push("Campo obrigatório 'expectedVersion' ausente ou inválido (deve ser inteiro >= 0).");
  }

  if (!isNonEmptyString(raw["capability"])) {
    errors.push("Campo obrigatório 'capability' ausente ou inválido (deve ser string não-vazia).");
  }

  if ("timestamp" in raw && raw["timestamp"] !== undefined) {
    if (typeof raw["timestamp"] !== "number" || !Number.isFinite(raw["timestamp"])) {
      errors.push("Campo opcional 'timestamp' deve ser um número finito quando presente.");
    }
  }

  if ("metadata" in raw && raw["metadata"] !== undefined) {
    if (!isRecord(raw["metadata"])) {
      errors.push("Campo opcional 'metadata' deve ser um objeto do tipo chave-valor quando presente.");
    }
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
    value: raw as unknown as MutableCommandEnvelope<T>,
  };
}

/**
 * Alias de conveniência para validateMutableCommandEnvelope.
 */
export function validateCommandEnvelope<T = unknown>(
  raw: unknown,
): EnvelopeValidationResult<T> {
  return validateMutableCommandEnvelope<T>(raw);
}

/**
 * Afirma que o dado fornecido é um MutableCommandEnvelope válido.
 * Lança ProtocolError com código 'INVALID_STATE' caso haja violação.
 */
export function assertMutableCommandEnvelope<T = unknown>(
  raw: unknown,
): asserts raw is MutableCommandEnvelope<T> {
  const result = validateMutableCommandEnvelope<T>(raw);
  if (!result.valid) {
    throw new ProtocolError(
      result.code,
      `Envelope de comando inválido: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
}

/**
 * Alias de conveniência para assertMutableCommandEnvelope.
 */
export function assertCommandEnvelope<T = unknown>(
  raw: unknown,
): asserts raw is MutableCommandEnvelope<T> {
  assertMutableCommandEnvelope<T>(raw);
}
