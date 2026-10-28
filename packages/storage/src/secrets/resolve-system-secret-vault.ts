import { createInMemorySystemSecretVault } from "./in-memory-vault.js";
import { createLinuxSecretServiceVault } from "./linux-secret-service-vault.js";
import { createMacOsKeychainVault } from "./macos-keychain-vault.js";
import { createWindowsCredentialManagerVault } from "./windows-credential-manager-vault.js";
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
  if (process.platform === "win32") {
    return createWindowsCredentialManagerVault();
  }
  return createInMemorySystemSecretVault();
}
