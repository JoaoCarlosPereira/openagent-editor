import type { DatabaseSync } from "node:sqlite";

import {
  registerProviderProfile,
  type ProviderCapabilities,
  type RegisterProviderCredentialInput,
  type RegisterProviderProfileResult,
  type SystemSecretVault,
} from "@openagent/storage";

import { resolveCliProxyOpenAiBaseUrl } from "./cliproxy-provider-connection-catalog.js";

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
  const { endpoint } = await resolveCliProxyOpenAiBaseUrl(input.endpoint);

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
