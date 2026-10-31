import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const CAS_BLOB_SQL = `
CREATE TABLE IF NOT EXISTS cas_blob (
  content_hash TEXT PRIMARY KEY NOT NULL,
  byte_size INTEGER NOT NULL,
  ref_count INTEGER NOT NULL CHECK(ref_count >= 0)
);
`;

export const migration004CasBlobs: StorageMigration = {
  version: 4,
  description: "CAS SHA-256 para blobs com deduplicação (SES-01)",
  up(database: DatabaseSync) {
    database.exec(CAS_BLOB_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
