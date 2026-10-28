import { createInMemorySystemSecretVault } from "./in-memory-vault.js";
import { createLinuxSecretServiceVault } from "./linux-secret-service-vault.js";
import type { SystemSecretVault } from "./types.js";

/**
 * Resolve o adapter de cofre adequado à plataforma atual.
 * Em Linux usa Secret Service; em outros SOs usa memória até adapters dedicados (task seguinte).
 */
export function resolveSystemSecretVault(): SystemSecretVault {
  if (process.platform === "linux") {
    return createLinuxSecretServiceVault();
  }
  return createInMemorySystemSecretVault();
}
