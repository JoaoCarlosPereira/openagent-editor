import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const MESSAGE_FTS5_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  lexical_text,
  message_id UNINDEXED,
  session_id UNINDEXED,
  tokenize = 'unicode61'
);
`;

export const migration007MessageFts5: StorageMigration = {
  version: 7,
  description: "message_fts FTS5 para busca lexical em mensagens (SES-05)",
  up(database: DatabaseSync) {
    database.exec(MESSAGE_FTS5_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
