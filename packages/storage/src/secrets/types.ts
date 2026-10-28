/**
 * Abstração do cofre de segredos do sistema operacional (Keychain, Credential Manager, Secret Service).
 */
export type SystemSecretVaultBackend =
  | "linux-secret-service"
  | "macos-keychain"
  | "memory";

export type SystemSecretVault = {
  readonly backend: SystemSecretVaultBackend;
  store(service: string, account: string, secret: string): Promise<void>;
  read(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<void>;
};

export const OPENAGENT_SECRET_SERVICE = "openagent-editor";

export type ProviderCapabilities = {
  endpoint: string;
  model: string;
  availableModels: string[];
  supportsStreaming: boolean;
  supportsChatCompletions: boolean;
};

export type RegisterProviderCredentialInput = {
  profileId: string;
  endpoint: string;
  model: string;
  credential: string;
};

export type RegisterProviderCredentialResult = {
  secretRef: string;
  capabilities: ProviderCapabilities;
};
