import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS storage_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_resume (
  session_id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL
);
`;

export const migration001InitialSchema: StorageMigration = {
  version: 1,
  description: "storage_meta, session_resume e schema_version",
  up(database: DatabaseSync) {
    database.exec(INITIAL_SCHEMA_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
