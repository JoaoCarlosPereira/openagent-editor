import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const CHECKPOINT_SQL = `
CREATE TABLE IF NOT EXISTS checkpoint (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  label TEXT,
  base_hashes_ref TEXT NOT NULL,
  result_hashes_ref TEXT NOT NULL,
  patch_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_run_id ON checkpoint(run_id);
`;

export const migration008Checkpoint: StorageMigration = {
  version: 8,
  description: "checkpoint com baseHashes, resultHashes e patchRef (SES-03)",
  up(database: DatabaseSync) {
    database.exec(CHECKPOINT_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
