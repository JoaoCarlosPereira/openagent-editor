import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const EVENT_LOG_SQL = `
CREATE TABLE IF NOT EXISTS harness_event (
  sequence INTEGER PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_ref TEXT NOT NULL,
  timestamp REAL NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_harness_event_run_id ON harness_event(run_id);
`;

export const migration003EventLog: StorageMigration = {
  version: 3,
  description: "event log append-only com sequence monotônico (SES-01)",
  up(database: DatabaseSync) {
    database.exec(EVENT_LOG_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
