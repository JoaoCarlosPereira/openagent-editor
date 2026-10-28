import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const WORKSPACE_SESSION_RUN_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY NOT NULL,
  root_path TEXT NOT NULL,
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  provider_profile_id TEXT,
  context_limit INTEGER
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  branch_id TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id)
);

CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  parent_run_id TEXT,
  state TEXT NOT NULL,
  hypothesis TEXT,
  started_at TEXT,
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES session(id)
);
`;

export const migration002WorkspaceSessionRun: StorageMigration = {
  version: 2,
  description: "workspace, session e run (SES-01)",
  up(database: DatabaseSync) {
    database.exec(WORKSPACE_SESSION_RUN_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
