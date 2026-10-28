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

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) {
    return STANDARD_LOG_REDACTED;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return redactForStandardLog(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry && typeof entry === "object"
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

export function formatStandardLogToolAction(
  input: StandardLogToolActionInput,
): Record<string, unknown> {
  return redactForStandardLog({
    kind: "tool_action",
    ...input,
  });
}
