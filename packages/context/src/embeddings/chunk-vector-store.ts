import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { chunkContextFileText, DEFAULT_CONTEXT_INDEX_CHUNK_SIZE } from "../indexer/chunk-text.js";
import { hashContextFileContent } from "../indexer/content-hash.js";
import { evaluateContextPathExclusion } from "../exclusions/rules.js";
import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { cosineSimilarity, embedTextWithLocalModel } from "./deterministic-local-embedder.js";
import type {
  EmbeddingSearchHit,
  RegisteredLocalEmbeddingModel,
  ReindexPathEmbeddingsOnSaveInput,
  ReindexPathEmbeddingsOnSaveResult,
} from "./types.js";

export const EMBEDDING_VECTOR_REF_PREFIX = "sha256:";

const CHUNK_VECTOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS context_embedding_vector (
  vector_ref TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS context_chunk_embedding (
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  vector_ref TEXT NOT NULL,
  PRIMARY KEY (path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_context_chunk_embedding_path
  ON context_chunk_embedding(path);
`;

function vectorInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

export function ensureContextChunkVectorSchema(database: DatabaseSync): void {
  database.exec(CHUNK_VECTOR_SCHEMA_SQL);
}

export function formatEmbeddingVectorRef(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  const hex = createHash("sha256").update(bytes).digest("hex");
  return `${EMBEDDING_VECTOR_REF_PREFIX}${hex}`;
}

function vectorBytesFromFloat32(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function float32FromVectorBytes(bytes: Buffer, dimensions: number): Float32Array {
  if (bytes.byteLength !== dimensions * 4) {
    vectorInvalid("vector_blob com dimensões incompatíveis com o modelo.");
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, dimensions);
}

function writeContextChunkVectorRef(
  database: DatabaseSync,
  model: RegisteredLocalEmbeddingModel,
  input: {
    path: string;
    chunkIndex: number;
    contentHash: string;
    lexicalText: string;
  },
): string {
  const vector = embedTextWithLocalModel(model, input.lexicalText);
  if (vector.length !== model.manifest.dimensions) {
    vectorInvalid("dimensões do embedding divergentes do manifesto.");
  }

  const vectorRef = formatEmbeddingVectorRef(vector);
  const vectorBlob = vectorBytesFromFloat32(vector);

  database
    .prepare(
      `INSERT INTO context_embedding_vector(vector_ref, model_id, dimensions, vector_blob)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vector_ref) DO NOTHING`,
    )
    .run(vectorRef, model.manifest.modelId, model.manifest.dimensions, vectorBlob);

  database
    .prepare(
      `INSERT INTO context_chunk_embedding(path, chunk_index, content_hash, vector_ref)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path, chunk_index) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector_ref = excluded.vector_ref`,
    )
    .run(input.path, input.chunkIndex, input.contentHash, vectorRef);

  return vectorRef;
}

export function upsertContextChunkVectorRef(
  database: DatabaseSync,
  model: RegisteredLocalEmbeddingModel,
  input: {
    path: string;
    chunkIndex: number;
    contentHash: string;
    lexicalText: string;
  },
): string {
  ensureContextChunkVectorSchema(database);
  database.exec("BEGIN IMMEDIATE");
  try {
    const vectorRef = writeContextChunkVectorRef(database, model, input);
    database.exec("COMMIT");
    return vectorRef;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Remove metadados de embedding de todos os chunks de um path indexado. */
export function removeContextChunkVectorsForPath(database: DatabaseSync, filePath: string): void {
  ensureContextChunkVectorSchema(database);
  database.prepare("DELETE FROM context_chunk_embedding WHERE path = ?").run(filePath);
}

/** Apaga todas as linhas de embedding persistidas do workspace. */
export function clearContextChunkVectors(database: DatabaseSync): void {
  ensureContextChunkVectorSchema(database);
  database.exec("DELETE FROM context_chunk_embedding");
  database.exec("DELETE FROM context_embedding_vector");
}

function requireIndexedPath(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    vectorInvalid("path inválido para embeddings persistidos.");
  }
  return path.trim();
}

/**
 * Reindexação incremental por path com vetores locais persistidos (CTX-02).
 */
export function reindexPersistedPathEmbeddingsOnSave(
  database: DatabaseSync,
  model: RegisteredLocalEmbeddingModel,
  input: ReindexPathEmbeddingsOnSaveInput,
  chunkSize = DEFAULT_CONTEXT_INDEX_CHUNK_SIZE,
): ReindexPathEmbeddingsOnSaveResult {
  ensureContextChunkVectorSchema(database);

  const path = requireIndexedPath(input.path);
  if (typeof input.content !== "string") {
    vectorInvalid("content inválido para embeddings persistidos.");
  }

  const contentHash = input.contentHash ?? hashContextFileContent(input.content);
  if (typeof contentHash !== "string" || contentHash.trim().length === 0) {
    vectorInvalid("contentHash inválido para embeddings persistidos.");
  }

  const unchangedRow = database
    .prepare(
      `SELECT content_hash AS contentHash, COUNT(*) AS chunkCount
       FROM context_chunk_embedding
       WHERE path = ?
       GROUP BY content_hash`,
    )
    .get(path) as { contentHash?: string; chunkCount?: number } | undefined;

  if (unchangedRow?.contentHash === contentHash) {
    return {
      path,
      contentHash,
      chunkCount: Number(unchangedRow.chunkCount) || 0,
      indexed: false,
      skippedReason: "unchanged",
    };
  }

  const chunks = chunkContextFileText(input.content, chunkSize);

  database.exec("BEGIN IMMEDIATE");
  try {
    removeContextChunkVectorsForPath(database, path);
    for (const chunk of chunks) {
      writeContextChunkVectorRef(database, model, {
        path,
        chunkIndex: chunk.chunkIndex,
        contentHash,
        lexicalText: chunk.lexicalText,
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    path,
    contentHash,
    chunkCount: chunks.length,
    indexed: true,
  };
}

export function searchPersistedChunkEmbeddings(
  database: DatabaseSync,
  model: RegisteredLocalEmbeddingModel,
  query: string,
  limit = 8,
  exclusionRuleset?: ContextExclusionRuleset,
): EmbeddingSearchHit[] {
  ensureContextChunkVectorSchema(database);

  if (typeof query !== "string" || query.trim().length === 0) {
    vectorInvalid("query inválida para busca semântica local persistida.");
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    vectorInvalid("limit inválido para busca semântica local persistida.");
  }

  const queryVector = embedTextWithLocalModel(model, query.trim());
  const rows = database
    .prepare(
      `SELECT
         c.path AS path,
         c.chunk_index AS chunkIndex,
         v.vector_blob AS vectorBlob
       FROM context_chunk_embedding AS c
       INNER JOIN context_embedding_vector AS v ON v.vector_ref = c.vector_ref
       WHERE v.model_id = ?`,
    )
    .all(model.manifest.modelId) as Array<{
    path: string;
    chunkIndex: number;
    vectorBlob: Buffer;
  }>;

  const hits: EmbeddingSearchHit[] = [];
  for (const row of rows) {
    if (exclusionRuleset) {
      const exclusion = evaluateContextPathExclusion({
        ruleset: exclusionRuleset,
        requestedPath: row.path,
      });
      if ("error" in exclusion || !exclusion.included) {
        continue;
      }
    }
    const vector = float32FromVectorBytes(row.vectorBlob, model.manifest.dimensions);
    const score = cosineSimilarity(queryVector, vector);
    if (score <= 0) {
      continue;
    }
    hits.push({
      path: row.path,
      chunkIndex: row.chunkIndex,
      score,
      lexicalText: "",
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
