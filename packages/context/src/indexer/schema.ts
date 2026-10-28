import type { DatabaseSync } from "node:sqlite";

const CONTEXT_INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_index_file (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS context_file_fts USING fts5(
  lexical_text,
  path UNINDEXED,
  chunk_index UNINDEXED,
  char_start UNINDEXED,
  char_end UNINDEXED,
  content_hash UNINDEXED,
  tokenize = 'unicode61'
);
`;

export function ensureContextIndexSchema(database: DatabaseSync): void {
  database.exec(CONTEXT_INDEX_SCHEMA_SQL);
}
