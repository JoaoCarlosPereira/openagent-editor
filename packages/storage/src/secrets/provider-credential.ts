import { ProtocolError } from "@openagent/protocol";
import { formatSecretRef, parseSecretRef, providerAccount } from "./secret-ref.js";
import type {
  ProviderCapabilities,
  RegisterProviderCredentialInput,
  RegisterProviderCredentialResult,
  SystemSecretVault,
} from "./types.js";
import { OPENAGENT_SECRET_SERVICE } from "./types.js";

export type ProbeProviderConnection = (
  input: RegisterProviderCredentialInput,
) => Promise<ProviderCapabilities>;

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim();
  const url = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProtocolError("INVALID_STATE", "Endpoint deve usar http ou https.");
  }
  return url.toString().replace(/\/$/, "");
}

function assertRegisterInput(input: RegisterProviderCredentialInput): RegisterProviderCredentialInput {
  const profileId = input.profileId?.trim();
  const model = input.model?.trim();
  const credential = input.credential?.trim();
  let endpoint: string;
  try {
    endpoint = normalizeEndpoint(input.endpoint ?? "");
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

type OpenAiModelsResponse = {
  data?: { id?: string }[];
};

/**
 * Sonda um endpoint compatível com OpenAI (/v1/models) para detectar capacidades.
 */
export async function probeOpenAiCompatibleProvider(
  input: RegisterProviderCredentialInput,
): Promise<ProviderCapabilities> {
  const normalized = assertRegisterInput(input);
  const modelsUrl = `${normalized.endpoint}/models`;
  let response: Response;
  try {
    response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${normalized.credential}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      "Não foi possível testar a conexão com o provedor.",
    );
  }
  if (!response.ok) {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      `Provedor recusou o teste de conexão (${response.status}).`,
    );
  }
  let body: OpenAiModelsResponse;
  try {
    body = (await response.json()) as OpenAiModelsResponse;
  } catch {
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      "Resposta inválida ao listar modelos do provedor.",
    );
  }
  const availableModels = (body.data ?? [])
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => Boolean(id));
  if (availableModels.length > 0 && !availableModels.includes(normalized.model)) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Modelo informado não está entre as capacidades detectadas.",
      ["model"],
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

/**
 * API-01 (parcial): testa conexão, expõe capacidades detectadas e persiste credencial no cofre.
 */
export async function registerProviderCredential(
  input: RegisterProviderCredentialInput,
  options: {
    vault: SystemSecretVault;
    probe?: ProbeProviderConnection;
  },
): Promise<RegisterProviderCredentialResult> {
  const normalized = assertRegisterInput(input);
  const probe = options.probe ?? probeOpenAiCompatibleProvider;
  const capabilities = await probe(normalized);

  const account = providerAccount(normalized.profileId);
  const payload = JSON.stringify({
    credential: normalized.credential,
    endpoint: normalized.endpoint,
    model: normalized.model,
  });
  await options.vault.store(OPENAGENT_SECRET_SERVICE, account, payload);

  const secretRef = formatSecretRef(options.vault.backend, OPENAGENT_SECRET_SERVICE, account);
  return { secretRef, capabilities };
}

export async function readProviderCredentialFromVault(
  secretRef: string,
  vault: SystemSecretVault,
): Promise<{ credential: string; endpoint: string; model: string } | null> {
  const parsed = parseSecretRef(secretRef);
  if (!parsed || parsed.backend !== vault.backend) {
    return null;
  }
  const raw = await vault.read(parsed.service, parsed.account);
  if (!raw) {
    return null;
  }
  try {
    const data = JSON.parse(raw) as { credential?: string; endpoint?: string; model?: string };
    if (!data.credential || !data.endpoint || !data.model) {
      return null;
    }
    return {
      credential: data.credential,
      endpoint: data.endpoint,
      model: data.model,
    };
  } catch {
    return null;
  }
}
