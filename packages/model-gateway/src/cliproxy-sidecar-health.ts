import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export type CliProxySidecarHealthInput = {
  openAiBaseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/**
 * Health check do sidecar: GET /v1/models com token de acesso efêmero.
 */
export async function checkCliProxySidecarHealth(
  input: CliProxySidecarHealthInput,
): Promise<{ ok: true; modelCount: number }> {
  const baseUrl = normalizeOpenAiBaseUrl(input.openAiBaseUrl);
  const token = input.accessToken.trim();
  if (!token) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Token do sidecar ausente.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const modelsUrl = `${baseUrl}/models`;
  let response: Response;
  try {
    response = await fetchImpl(modelsUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
    });
  } catch {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      "Health check do sidecar CLIProxyAPI falhou.",
    );
  }

  if (!response.ok) {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      `Health check do sidecar recusado (${response.status}).`,
    );
  }

  let body: { data?: unknown[] };
  try {
    body = (await response.json()) as { data?: unknown[] };
  } catch {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      "Health check do sidecar retornou JSON inválido.",
    );
  }

  return { ok: true, modelCount: body.data?.length ?? 0 };
}
