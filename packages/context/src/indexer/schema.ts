import type { DatabaseSync } from "node:sqlite";

const CONTEXT_INDEX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_index_file (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_index_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
);
INSERT OR IGNORE INTO context_index_revision(id, revision) VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS context_index_revision_insert AFTER INSERT ON context_index_file
BEGIN UPDATE context_index_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS context_index_revision_update AFTER UPDATE ON context_index_file
BEGIN UPDATE context_index_revision SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS context_index_revision_delete AFTER DELETE ON context_index_file
BEGIN UPDATE context_index_revision SET revision = revision + 1 WHERE id = 1; END;

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
