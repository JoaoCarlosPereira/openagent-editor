import type { DatabaseSync } from "node:sqlite";

/** Remove todos os chunks FTS e metadados de um path indexado. */
export function removeContextFileIndex(database: DatabaseSync, filePath: string): void {
  database.prepare("DELETE FROM context_file_fts WHERE path = ?").run(filePath);
  database.prepare("DELETE FROM context_index_file WHERE path = ?").run(filePath);
}
