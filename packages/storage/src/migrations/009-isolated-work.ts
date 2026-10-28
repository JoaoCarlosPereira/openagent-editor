import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const ISOLATED_WORK_SQL = `
CREATE TABLE IF NOT EXISTS isolated_work (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  isolated_root TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'applied', 'discarded')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_isolated_work_run_id ON isolated_work(run_id);
CREATE INDEX IF NOT EXISTS idx_isolated_work_state ON isolated_work(state);
`;

export const migration009IsolatedWork: StorageMigration = {
  version: 9,
  description: "trabalho isolado por git worktree (SES-04)",
  up(database: DatabaseSync) {
    database.exec(ISOLATED_WORK_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
