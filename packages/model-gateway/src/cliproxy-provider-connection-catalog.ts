import type { ProviderCapabilities, RegisterProviderCredentialInput } from "@openagent/storage";
import { probeOpenAiCompatibleProvider } from "@openagent/storage";

import { loadPinnedCliProxyApiSidecar } from "./load-pinned-cliproxyapi-sidecar.js";
import type { CliProxySidecarPinManifest } from "./types.js";

export type CliProxyProviderConnectionInput = {
  model: string;
  credential: string;
  endpoint?: string;
};

export type CliProxyProviderCapabilitiesCatalog = ProviderCapabilities & {
  sidecar: {
    component: CliProxySidecarPinManifest["component"];
    version: string;
    gitCommitShort: string;
    defaultOpenAiBaseUrl: string;
  };
  /** Rotas OpenAI-compat expostas pelo gateway após o teste de conexão. */
  compatibleRoutes: readonly ["models", "chat.completions"];
};

function normalizeOpenAiBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/**
 * Resolve o endpoint OpenAI-compat do CLIProxyAPI (pin ou informado pela pessoa).
 */
export async function resolveCliProxyOpenAiBaseUrl(endpoint?: string): Promise<{
  endpoint: string;
  manifest: CliProxySidecarPinManifest;
}> {
  const pin = await loadPinnedCliProxyApiSidecar();
  const resolved = endpoint?.trim()
    ? normalizeOpenAiBaseUrl(endpoint)
    : pin.manifest.defaultOpenAiBaseUrl;
  return { endpoint: resolved, manifest: pin.manifest };
}

/**
 * API-01: testa a conexão com o endpoint CLIProxyAPI e devolve o catálogo de capacidades detectadas.
 */
export async function catalogCliProxyProviderCapabilities(
  input: CliProxyProviderConnectionInput,
  options?: {
    probe?: (input: RegisterProviderCredentialInput) => Promise<ProviderCapabilities>;
  },
): Promise<CliProxyProviderCapabilitiesCatalog> {
  const { endpoint, manifest } = await resolveCliProxyOpenAiBaseUrl(input.endpoint);
  const probe = options?.probe ?? probeOpenAiCompatibleProvider;
  const capabilities = await probe({
    profileId: "catalog-probe",
    endpoint,
    model: input.model,
    credential: input.credential,
  });

  return {
    ...capabilities,
    endpoint,
    sidecar: {
      component: manifest.component,
      version: manifest.version,
      gitCommitShort: manifest.gitCommitShort,
      defaultOpenAiBaseUrl: manifest.defaultOpenAiBaseUrl,
    },
    compatibleRoutes: ["models", "chat.completions"],
  };
}
