import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { reindexPersistedPathEmbeddingsOnSave } from "../embeddings/chunk-vector-store.js";
import { evaluateContextPathExclusion } from "../exclusions/rules.js";
import { chunkContextFileText, DEFAULT_CONTEXT_INDEX_CHUNK_SIZE } from "./chunk-text.js";
import { hashContextFileContent } from "./content-hash.js";
import { removeContextFileIndex } from "./remove-context-file-index.js";
import { ensureContextIndexSchema } from "./schema.js";
import type { IndexContextFileInput, IndexContextFileResult } from "./types.js";

function indexInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireIndexedPath(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    indexInvalid("path inválido para indexação de contexto.");
  }
  return path.trim();
}

function readStoredContentHash(
  database: DatabaseSync,
  path: string,
): string | undefined {
  const row = database
    .prepare("SELECT content_hash AS contentHash FROM context_index_file WHERE path = ?")
    .get(path) as { contentHash?: string } | undefined;
  return row?.contentHash;
}

/**
 * Indexação incremental por arquivo (CTX-02): substitui apenas chunks do path salvo.
 */
export function indexContextFile(
  database: DatabaseSync,
  input: IndexContextFileInput,
): IndexContextFileResult {
  ensureContextIndexSchema(database);

  const path = requireIndexedPath(input.path);
  if (typeof input.content !== "string") {
    indexInvalid("content inválido para indexação de contexto.");
  }

  const contentHash = input.contentHash ?? hashContextFileContent(input.content);
  if (typeof contentHash !== "string" || contentHash.trim().length === 0) {
    indexInvalid("contentHash inválido para indexação de contexto.");
  }

  if (input.exclusionRuleset) {
    const exclusion = evaluateContextPathExclusion({
      ruleset: input.exclusionRuleset,
      requestedPath: path,
    });
    if ("error" in exclusion) {
      indexInvalid(exclusion.error.message, exclusion.error.details);
    }
    if (!exclusion.included) {
      removeContextFileIndex(database, path);
      return {
        path,
        contentHash,
        chunkCount: 0,
        indexed: false,
        skippedReason: "excluded",
      };
    }
  }

  const storedHash = readStoredContentHash(database, path);
  if (storedHash === contentHash) {
    return {
      path,
      contentHash,
      chunkCount: 0,
      indexed: false,
      skippedReason: "unchanged",
    };
  }

  const chunkSize = input.chunkSize ?? DEFAULT_CONTEXT_INDEX_CHUNK_SIZE;
  const chunks = chunkContextFileText(input.content, chunkSize);

  database.exec("BEGIN IMMEDIATE");
  try {
    removeContextFileIndex(database, path);
    const insertChunk = database.prepare(
      `INSERT INTO context_file_fts(
        lexical_text, path, chunk_index, char_start, char_end, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of chunks) {
      insertChunk.run(
        chunk.lexicalText,
        path,
        chunk.chunkIndex,
        chunk.charStart,
        chunk.charEnd,
        contentHash,
      );
    }
    database
      .prepare(
        `INSERT INTO context_index_file(path, content_hash, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      )
      .run(path, contentHash, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  if (input.embeddingModel) {
    reindexPersistedPathEmbeddingsOnSave(database, input.embeddingModel, {
      path,
      content: input.content,
      contentHash,
    }, chunkSize);
  }

  return {
    path,
    contentHash,
    chunkCount: chunks.length,
    indexed: true,
  };
}
