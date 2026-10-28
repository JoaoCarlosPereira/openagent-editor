export {
  createInMemorySystemSecretVault,
} from "./in-memory-vault.js";
export {
  createLinuxSecretServiceVault,
  type SecretToolRunner,
} from "./linux-secret-service-vault.js";
export {
  probeOpenAiCompatibleProvider,
  readProviderCredentialFromVault,
  registerProviderCredential,
  type ProbeProviderConnection,
} from "./provider-credential.js";
export { resolveSystemSecretVault } from "./resolve-system-secret-vault.js";
export {
  formatSecretRef,
  parseSecretRef,
  providerAccount,
  type ParsedSecretRef,
} from "./secret-ref.js";
export {
  OPENAGENT_SECRET_SERVICE,
  type ProviderCapabilities,
  type RegisterProviderCredentialInput,
  type RegisterProviderCredentialResult,
  type SystemSecretVault,
  type SystemSecretVaultBackend,
} from "./types.js";
