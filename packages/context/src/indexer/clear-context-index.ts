import type { DatabaseSync } from "node:sqlite";

import { clearContextChunkVectors } from "../embeddings/chunk-vector-store.js";
import {
  describeContextIndexSize,
  type ContextIndexSizeSnapshot,
} from "./describe-context-index.js";

export interface ClearWorkspaceContextIndexResult {
  scope: "workspace";
  size: ContextIndexSizeSnapshot;
}

/** Apaga todos os dados locais do índice lexical do workspace (CTX-04). */
export function clearWorkspaceContextIndex(
  database: DatabaseSync,
): ClearWorkspaceContextIndexResult {
  const size = describeContextIndexSize(database);
  database.exec("DELETE FROM context_file_fts");
  database.exec("DELETE FROM context_index_file");
  clearContextChunkVectors(database);
  return { scope: "workspace", size };
}
