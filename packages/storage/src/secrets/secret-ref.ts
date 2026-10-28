import type { SystemSecretVaultBackend } from "./types.js";

const SECRET_REF_PREFIX = "sysvault:";

export type ParsedSecretRef = {
  backend: SystemSecretVaultBackend;
  service: string;
  account: string;
};

export function formatSecretRef(
  backend: SystemSecretVaultBackend,
  service: string,
  account: string,
): string {
  return `${SECRET_REF_PREFIX}${backend}:${service}/${account}`;
}

export function parseSecretRef(secretRef: string): ParsedSecretRef | null {
  if (!secretRef.startsWith(SECRET_REF_PREFIX)) {
    return null;
  }
  const body = secretRef.slice(SECRET_REF_PREFIX.length);
  const colon = body.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const backend = body.slice(0, colon) as SystemSecretVaultBackend;
  if (backend !== "linux-secret-service" && backend !== "memory") {
    return null;
  }
  const rest = body.slice(colon + 1);
  const slash = rest.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const service = rest.slice(0, slash);
  const account = rest.slice(slash + 1);
  if (!service || !account) {
    return null;
  }
  return { backend, service, account };
}

export function providerAccount(profileId: string): string {
  return `provider/${profileId}`;
}
