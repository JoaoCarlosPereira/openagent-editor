import type { DatabaseSync } from "node:sqlite";
import {
  registerProviderCredential,
  type ProbeProviderConnection,
} from "./provider-credential.js";
import {
  getStoredProviderProfile,
  upsertStoredProviderProfile,
  type StoredProviderProfile,
} from "./provider-profile-store.js";
import { formatStandardLogToolAction } from "./standard-log-redaction.js";
import type {
  ProviderCapabilities,
  RegisterProviderCredentialInput,
  SystemSecretVault,
} from "./types.js";

export type RegisterProviderProfileResult = {
  profile: StoredProviderProfile;
  capabilities: ProviderCapabilities;
  standardLog: Record<string, unknown>;
};

/**
 * API-01 + PRV-02: testa conexão, persiste credencial no cofre, grava ProviderProfile
 * no SQLite apenas com secretRef (sem segredo) e emite log padrão redigido.
 */
export async function registerProviderProfile(
  database: DatabaseSync,
  input: RegisterProviderCredentialInput,
  options: {
    vault: SystemSecretVault;
    probe?: ProbeProviderConnection;
    workspaceId?: string;
  },
): Promise<RegisterProviderProfileResult> {
  const { secretRef, capabilities } = await registerProviderCredential(input, {
    vault: options.vault,
    probe: options.probe,
  });

  const profile = upsertStoredProviderProfile(database, {
    id: input.profileId.trim(),
    endpoint: capabilities.endpoint,
    model: capabilities.model,
    capabilities,
    secretRef,
  });

  if (options.workspaceId) {
    database
      .prepare(`UPDATE workspace SET provider_profile_id = ? WHERE id = ?`)
      .run(profile.id, options.workspaceId);
  }

  const standardLog = formatStandardLogToolAction({
    tool: "provider.register",
    target: profile.endpoint,
    profileId: profile.id,
    model: profile.model,
    secretRef: profile.secretRef,
    credential: input.credential,
    capabilities: profile.capabilities,
  });

  return {
    profile: getStoredProviderProfile(database, profile.id) ?? profile,
    capabilities,
    standardLog,
  };
}
