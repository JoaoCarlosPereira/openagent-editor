import type { DatabaseSync } from "node:sqlite";

import {
  registerProviderProfile,
  type ProviderCapabilities,
  type RegisterProviderCredentialInput,
  type RegisterProviderProfileResult,
  type SystemSecretVault,
} from "@openagent/storage";

import { loadPinnedCliProxyApiSidecar } from "./load-pinned-cliproxyapi-sidecar.js";

export type RegisterCliProxyProviderInput = {
  profileId: string;
  model: string;
  credential: string;
  endpoint?: string;
};

/**
 * API-01 (gateway): usa o endpoint loopback do pin quando omitido, testa conexão,
 * expõe capacidades e persiste credencial via cofre + ProviderProfile.
 */
export async function registerCliProxyProviderProfile(
  database: DatabaseSync,
  input: RegisterCliProxyProviderInput,
  options: {
    vault: SystemSecretVault;
    probe?: (input: RegisterProviderCredentialInput) => Promise<ProviderCapabilities>;
    workspaceId?: string;
  },
): Promise<RegisterProviderProfileResult> {
  const pin = await loadPinnedCliProxyApiSidecar();
  const endpoint = input.endpoint?.trim() || pin.manifest.defaultOpenAiBaseUrl;

  return registerProviderProfile(
    database,
    {
      profileId: input.profileId,
      model: input.model,
      credential: input.credential,
      endpoint,
    },
    {
      vault: options.vault,
      probe: options.probe,
      workspaceId: options.workspaceId,
    },
  );
}
