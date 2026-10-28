import { ProtocolError } from "@openagent/protocol";
import type { ProviderCapabilities, RegisterProviderCredentialInput } from "@openagent/storage";

import {
  mapCliProxyFetchNetworkError,
  mapCliProxyFetchTimeoutError,
  mapCliProxyOpenAiHttpFailure,
} from "./cliproxy-provider-errors.js";

type OpenAiModelsResponse = {
  data?: { id?: string }[];
};

function normalizeProbeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function assertProbeInput(input: RegisterProviderCredentialInput): RegisterProviderCredentialInput {
  const profileId = input.profileId?.trim();
  const model = input.model?.trim();
  const credential = input.credential?.trim();
  let endpoint: string;
  try {
    const url = new URL(input.endpoint?.trim() ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("protocol");
    }
    endpoint = normalizeProbeEndpoint(url.toString().replace(/\/$/, ""));
  } catch {
    throw new ProtocolError("INVALID_STATE", "Endpoint inválido.", ["endpoint"]);
  }
  const details: string[] = [];
  if (!profileId) details.push("profileId");
  if (!model) details.push("model");
  if (!credential) details.push("credential");
  if (details.length > 0 || !profileId || !model || !credential) {
    throw new ProtocolError("INVALID_STATE", "Entrada de provedor incompleta ou inválida.", details);
  }
  return { profileId, model, credential, endpoint };
}

/**
 * API-02: sonda /v1/models mapeando timeout, 429 e capacidade ausente para PROVIDER_* estáveis.
 */
export async function probeCliProxyOpenAiCompatibleProvider(
  input: RegisterProviderCredentialInput,
): Promise<ProviderCapabilities> {
  const normalized = assertProbeInput(input);
  const modelsUrl = `${normalized.endpoint}/models`;
  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${normalized.credential}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw mapCliProxyFetchTimeoutError("models");
    }
    throw mapCliProxyFetchNetworkError("models");
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw mapCliProxyOpenAiHttpFailure(
      response.status,
      bodyText,
      `Provedor recusou o teste de conexão (${response.status}).`,
    );
  }

  let body: OpenAiModelsResponse;
  try {
    body = JSON.parse(bodyText) as OpenAiModelsResponse;
  } catch {
    throw new ProtocolError(
      "INVALID_STATE",
      "Resposta inválida ao listar modelos do provedor.",
      ["models"],
    );
  }

  const availableModels = (body.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (availableModels.length > 0 && !availableModels.includes(normalized.model)) {
    throw mapCliProxyOpenAiHttpFailure(
      404,
      JSON.stringify({
        error: {
          message: `Modelo "${normalized.model}" não está entre as capacidades detectadas.`,
          type: "capability_missing",
        },
      }),
      "Capacidade solicitada não está disponível no provedor.",
    );
  }

  return {
    endpoint: normalized.endpoint,
    model: normalized.model,
    availableModels,
    supportsStreaming: true,
    supportsChatCompletions: true,
  };
}
