import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const PROVIDER_PROFILE_SQL = `
CREATE TABLE IF NOT EXISTS provider_profile (
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  secret_ref TEXT NOT NULL
);
`;

export const migration006ProviderProfile: StorageMigration = {
  version: 6,
  description: "provider_profile com secretRef (API-01 / PRV-02)",
  up(database: DatabaseSync) {
    database.exec(PROVIDER_PROFILE_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
