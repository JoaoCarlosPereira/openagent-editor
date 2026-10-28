import { createInMemorySystemSecretVault } from "./in-memory-vault.js";
import { createLinuxSecretServiceVault } from "./linux-secret-service-vault.js";
import { createMacOsKeychainVault } from "./macos-keychain-vault.js";
import type { SystemSecretVault } from "./types.js";

/**
 * Resolve o adapter de cofre adequado à plataforma atual.
 */
export function resolveSystemSecretVault(): SystemSecretVault {
  if (process.platform === "linux") {
    return createLinuxSecretServiceVault();
  }
  if (process.platform === "darwin") {
    return createMacOsKeychainVault();
  }
  return createInMemorySystemSecretVault();
}
