import type { SystemSecretVault } from "./types.js";

type VaultKey = `${string}\0${string}`;

function vaultKey(service: string, account: string): VaultKey {
  return `${service}\0${account}`;
}

/** Cofre em memória para testes e ambientes sem Secret Service disponível. */
export function createInMemorySystemSecretVault(): SystemSecretVault {
  const secrets = new Map<VaultKey, string>();

  return {
    backend: "memory",
    async store(service, account, secret) {
      secrets.set(vaultKey(service, account), secret);
    },
    async read(service, account) {
      return secrets.get(vaultKey(service, account)) ?? null;
    },
    async delete(service, account) {
      secrets.delete(vaultKey(service, account));
    },
  };
}
