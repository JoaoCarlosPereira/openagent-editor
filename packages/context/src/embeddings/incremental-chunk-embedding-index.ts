import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { chunkContextFileText } from "../indexer/chunk-text.js";
import { hashContextFileContent } from "../indexer/content-hash.js";
import { cosineSimilarity, embedTextWithLocalModel } from "./deterministic-local-embedder.js";
import type {
  EmbeddingSearchHit,
  IndexedPathEmbeddings,
  RegisteredLocalEmbeddingModel,
  ReindexPathEmbeddingsOnSaveInput,
  ReindexPathEmbeddingsOnSaveResult,
} from "./types.js";

export type IncrementalChunkEmbeddingIndex = {
  model: RegisteredLocalEmbeddingModel;
  paths: Map<string, IndexedPathEmbeddings>;
};

function indexInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireIndexedPath(path: string): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    indexInvalid("path inválido para embeddings incrementais.");
  }
  return path.trim();
}

export function createIncrementalChunkEmbeddingIndex(
  model: RegisteredLocalEmbeddingModel,
): IncrementalChunkEmbeddingIndex {
  if (!model?.manifest?.dimensions) {
    indexInvalid("modelo local de embeddings inválido para índice incremental.");
  }
  return {
    model,
    paths: new Map(),
  };
}

/**
 * Reindexação incremental por path (CTX-02): substitui apenas embeddings do arquivo salvo.
 */
export function reindexPathEmbeddingsOnSave(
  index: IncrementalChunkEmbeddingIndex,
  input: ReindexPathEmbeddingsOnSaveInput,
): ReindexPathEmbeddingsOnSaveResult {
  const path = requireIndexedPath(input.path);
  if (typeof input.content !== "string") {
    indexInvalid("content inválido para embeddings incrementais.");
  }

  const contentHash = input.contentHash ?? hashContextFileContent(input.content);
  if (typeof contentHash !== "string" || contentHash.trim().length === 0) {
    indexInvalid("contentHash inválido para embeddings incrementais.");
  }

  const existing = index.paths.get(path);
  if (existing?.contentHash === contentHash) {
    return {
      path,
      contentHash,
      chunkCount: existing.chunks.length,
      indexed: false,
      skippedReason: "unchanged",
    };
  }

  const chunks = chunkContextFileText(input.content);
  const embedded = chunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
    lexicalText: chunk.lexicalText,
    vector: embedTextWithLocalModel(index.model, chunk.lexicalText),
  }));

  index.paths.set(path, {
    path,
    contentHash,
    chunks: embedded,
  });

  return {
    path,
    contentHash,
    chunkCount: embedded.length,
    indexed: true,
  };
}

export function searchIncrementalChunkEmbeddings(
  index: IncrementalChunkEmbeddingIndex,
  query: string,
  limit = 8,
): EmbeddingSearchHit[] {
  if (typeof query !== "string" || query.trim().length === 0) {
    indexInvalid("query inválida para busca semântica local.");
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    indexInvalid("limit inválido para busca semântica local.");
  }

  const queryVector = embedTextWithLocalModel(index.model, query.trim());
  const hits: EmbeddingSearchHit[] = [];

  for (const entry of index.paths.values()) {
    for (const chunk of entry.chunks) {
      const score = cosineSimilarity(queryVector, chunk.vector);
      if (score <= 0) {
        continue;
      }
      hits.push({
        path: entry.path,
        chunkIndex: chunk.chunkIndex,
        score,
        lexicalText: chunk.lexicalText,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
