import type { DatabaseSync } from "node:sqlite";
import type { ProviderCapabilities } from "./types.js";

export type StoredProviderProfile = {
  id: string;
  endpoint: string;
  model: string;
  capabilities: ProviderCapabilities;
  secretRef: string;
};

type ProviderProfileRow = {
  id: string;
  endpoint: string;
  model: string;
  capabilitiesJson: string;
  secretRef: string;
};

function rowToProfile(row: ProviderProfileRow): StoredProviderProfile {
  const capabilities = JSON.parse(row.capabilitiesJson) as ProviderCapabilities;
  return {
    id: row.id,
    endpoint: row.endpoint,
    model: row.model,
    capabilities,
    secretRef: row.secretRef,
  };
}

export function upsertStoredProviderProfile(
  database: DatabaseSync,
  profile: StoredProviderProfile,
): StoredProviderProfile {
  database
    .prepare(
      `INSERT INTO provider_profile(id, endpoint, model, capabilities_json, secret_ref)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         endpoint = excluded.endpoint,
         model = excluded.model,
         capabilities_json = excluded.capabilities_json,
         secret_ref = excluded.secret_ref`,
    )
    .run(
      profile.id,
      profile.endpoint,
      profile.model,
      JSON.stringify(profile.capabilities),
      profile.secretRef,
    );
  return profile;
}

export function getStoredProviderProfile(
  database: DatabaseSync,
  profileId: string,
): StoredProviderProfile | null {
  const row = database
    .prepare(
      `SELECT id, endpoint, model, capabilities_json AS capabilitiesJson, secret_ref AS secretRef
       FROM provider_profile WHERE id = ?`,
    )
    .get(profileId) as ProviderProfileRow | undefined;
  if (!row) {
    return null;
  }
  return rowToProfile(row);
}

/** Garante que nenhuma coluna textual de provider_profile contém o segredo em claro. */
export function providerProfileSqliteContainsPlaintext(
  database: DatabaseSync,
  plaintext: string,
): boolean {
  const rows = database
    .prepare(
      `SELECT endpoint, model, capabilities_json, secret_ref FROM provider_profile`,
    )
    .all() as { endpoint: string; model: string; capabilities_json: string; secret_ref: string }[];
  for (const row of rows) {
    const blob = `${row.endpoint}\0${row.model}\0${row.capabilities_json}\0${row.secret_ref}`;
    if (blob.includes(plaintext)) {
      return true;
    }
  }
  return false;
}
