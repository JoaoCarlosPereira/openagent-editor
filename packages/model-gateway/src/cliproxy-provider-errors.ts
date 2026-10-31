import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  providerFailureError,
  type ProviderFailureReason,
} from "@openagent/protocol";

export type OpenAiCompatibleErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
};

/** Redige credenciais de provedor encontradas em strings de erro/log. */
export function redactProviderCredentials(input: string, credential?: string): string {
  let result = input;
  if (credential) {
    result = result.replaceAll(credential, "[REDACTED]");
  }
  const patterns: Array<[RegExp, string]> = [
    [/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
    [/Bearer\s+[^\s,;"'<>]+/gi, "Bearer [REDACTED]"],
    [/token["']?\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}/gi, 'token: "[REDACTED]"'],
  ];
  for (const [pattern, replacement] of patterns) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function providerFailurePreservationHints(): {
  preservePrompt: true;
  preserveDiff: true;
} {
  return { preservePrompt: true, preserveDiff: true };
}

/**
 * Extrai a causa legível retornada pelo provedor OpenAI-compatible (CLIProxyAPI).
 */
export function parseOpenAiCompatibleErrorBody(
  bodyText: string,
  fallbackMessage: string,
  credential?: string,
): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return fallbackMessage;
  }
  try {
    const parsed = JSON.parse(trimmed) as OpenAiCompatibleErrorBody;
    const message = parsed.error?.message?.trim();
    if (message) {
      return redactProviderCredentials(message, credential);
    }
  } catch {
    // texto bruto abaixo
  }
  return redactProviderCredentials(trimmed.slice(0, 500), credential);
}

/**
 * Infere o motivo estável PROVIDER_* a partir do status HTTP e da causa do provedor.
 */
export function inferCliProxyProviderFailureReason(
  status: number,
  providerCause: string,
): ProviderFailureReason {
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  const lower = providerCause.toLowerCase();
  if (
    lower.includes("rate") ||
    lower.includes("429") ||
    lower.includes("too many")
  ) {
    return "rate_limit";
  }
  if (lower.includes("timeout") || lower.includes("deadline") || lower.includes("expired")) {
    return "timeout";
  }
  if (
    lower.includes("capability") ||
    lower.includes("not support") ||
    lower.includes("unsupported") ||
    lower.includes("does not support")
  ) {
    return "capability_missing";
  }
  if (status === 404 || status === 422) {
    return "capability_missing";
  }
  return "timeout";
}

/**
 * API-02: mapeia falha HTTP OpenAI-compatible para código estável PROVIDER_* com causa preservada.
 */
export function mapCliProxyOpenAiHttpFailure(
  status: number,
  bodyText: string,
  fallbackMessage = "Provedor recusou a requisição.",
  credential?: string,
): ProtocolError {
  const providerCause = parseOpenAiCompatibleErrorBody(bodyText, fallbackMessage, credential);
  const reason = inferCliProxyProviderFailureReason(status, providerCause);
  return providerFailureError(reason, providerCause);
}

/** @deprecated Use mapCliProxyOpenAiHttpFailure — alias do chat/completions. */
export const mapCliProxyChatCompletionHttpFailure = mapCliProxyOpenAiHttpFailure;

export function mapCliProxyInlineStreamErrorObject(
  error: OpenAiCompatibleErrorBody["error"],
): ProtocolError {
  const rawCause =
    error?.message?.trim() ||
    error?.type?.trim() ||
    "Provedor interrompeu o streaming.";
  const providerCause = redactProviderCredentials(rawCause);
  const codeHint = String(error?.code ?? error?.type ?? "");
  const reason = inferCliProxyProviderFailureReason(400, `${providerCause} ${codeHint}`);
  return providerFailureError(reason, providerCause);
}

export function mapCliProxyFetchTimeoutError(context: string): ProtocolError {
  return providerFailureError("timeout", `Tempo esgotado ao contatar o provedor (${context}).`);
}

export function mapCliProxyFetchNetworkError(context: string): ProtocolError {
  return providerFailureError("timeout", `Falha de rede ao contatar o provedor (${context}).`);
}

export function assertNonEmptyCliProxyField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Entrada inválida para o gateway de modelos.",
      [label],
    );
  }
  return value.trim();
}
