import type { DatabaseSync } from "node:sqlite";

import type { RegisterProviderProfileResult, SystemSecretVault } from "@openagent/storage";

import { registerCliProxyProviderProfile } from "./register-cliproxy-provider.js";
import {
  startCliProxySidecarSupervised,
  shutdownCliProxySidecarSupervised,
  type CliProxySidecarSupervisorHandle,
  type StartCliProxySidecarSupervisorOptions,
} from "./cliproxy-sidecar-supervisor.js";

export type RegisterSupervisedCliProxyProviderInput = {
  profileId: string;
  model: string;
};

export type RegisterSupervisedCliProxyProviderResult = {
  sidecar: CliProxySidecarSupervisorHandle;
  registration: RegisterProviderProfileResult;
};

/**
 * API-01: sobe sidecar supervisionado (loopback + token efêmero), testa conexão,
 * expõe capacidades e persiste credencial no cofre usando o endpoint local.
 */
export async function registerSupervisedCliProxyProviderProfile(
  database: DatabaseSync,
  input: RegisterSupervisedCliProxyProviderInput,
  options: {
    vault: SystemSecretVault;
    workspaceId?: string;
    sidecar?: StartCliProxySidecarSupervisorOptions;
  },
): Promise<RegisterSupervisedCliProxyProviderResult> {
  const sidecar = await startCliProxySidecarSupervised(options.sidecar ?? {});
  try {
    const registration = await registerCliProxyProviderProfile(
      database,
      {
        profileId: input.profileId,
        model: input.model,
        credential: sidecar.secrets.accessToken,
        endpoint: sidecar.openAiBaseUrl,
      },
      {
        vault: options.vault,
        workspaceId: options.workspaceId,
      },
    );
    return { sidecar, registration };
  } catch (error) {
    await shutdownCliProxySidecarSupervised(sidecar).catch(() => undefined);
    throw error;
  }
}
