import type { DatabaseSync } from "node:sqlite";

import { ensureContextIndexSchema } from "./schema.js";

export interface ContextIndexSizeSnapshot {
  indexedFileCount: number;
  chunkCount: number;
  lexicalBytes: number;
}

/** Mede o índice lexical persistido no workspace (CTX-04). */
export function describeContextIndexSize(database: DatabaseSync): ContextIndexSizeSnapshot {
  ensureContextIndexSchema(database);

  const fileRow = database
    .prepare("SELECT COUNT(*) AS count FROM context_index_file")
    .get() as { count: number };
  const chunkRow = database
    .prepare("SELECT COUNT(*) AS count FROM context_file_fts")
    .get() as { count: number };
  const bytesRow = database
    .prepare("SELECT COALESCE(SUM(length(lexical_text)), 0) AS bytes FROM context_file_fts")
    .get() as { bytes: number };

  return {
    indexedFileCount: Number(fileRow.count) || 0,
    chunkCount: Number(chunkRow.count) || 0,
    lexicalBytes: Number(bytesRow.bytes) || 0,
  };
}
