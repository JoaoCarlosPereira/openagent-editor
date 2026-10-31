import { ProtocolError } from "@openagent/protocol";

import type { PolicyValidationResult } from "./types.js";

export const STANDARD_LOG_REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "credential",
  "apiKey",
  "api_key",
  "token",
  "password",
  "secret",
  "authorization",
  "excludedFileContent",
  "excluded_file_content",
  "rawModelResponseBody",
  "raw_model_response_body",
]);

export type StandardLogToolActionInput = {
  tool: string;
  target?: string;
  credential?: string;
  excludedFileContent?: string;
  rawModelResponseBody?: string;
  [key: string]: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateStandardLogToolActionInput(
  raw: unknown,
): PolicyValidationResult<StandardLogToolActionInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Entrada de log padrão inválida (objeto esperado)."],
    };
  }
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.tool)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'tool' ausente ou inválido (string não-vazia)."],
    };
  }
  return {
    valid: true,
    value: { ...record, tool: record.tool.trim() } as StandardLogToolActionInput,
  };
}

export function assertValidStandardLogToolAction(
  raw: unknown,
): StandardLogToolActionInput {
  const result = validateStandardLogToolActionInput(raw);
  if (!result.valid) {
    throw new ProtocolError(result.code, result.errors[0] ?? "Entrada inválida.", result.errors);
  }
  return result.value;
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) {
    return STANDARD_LOG_REDACTED;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return redactForStandardLog(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? redactForStandardLog(entry as Record<string, unknown>)
        : entry,
    );
  }
  return value;
}

/** PRV-02: omite credencial, conteúdo excluído e corpo bruto do modelo no log padrão. */
export function redactForStandardLog(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

/** Registra ação de ferramenta no log padrão com campos sensíveis omitidos. */
export function formatStandardLogToolAction(
  input: StandardLogToolActionInput,
): Record<string, unknown> {
  const validated = assertValidStandardLogToolAction(input);
  return redactForStandardLog({
    kind: "tool_action",
    ...validated,
  });
}
