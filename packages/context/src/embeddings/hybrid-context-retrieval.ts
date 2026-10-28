import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { evaluateContextPathExclusion } from "../exclusions/rules.js";
import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { snippetFromLexicalText } from "../indexer/fts-query.js";
import { purgeExcludedContextIndexPaths } from "../indexer/purge-excluded-context-index.js";
import { searchContextIndex } from "../indexer/search-context-index.js";
import type {
  ContextIndexSearchHit,
  SearchContextIndexInput,
  SearchContextIndexResult,
} from "../indexer/types.js";
import { searchPersistedChunkEmbeddings } from "./chunk-vector-store.js";
import type { RegisteredLocalEmbeddingModel } from "./types.js";

export type SearchHybridContextIndexInput = SearchContextIndexInput & {
  embeddingModel: RegisteredLocalEmbeddingModel;
  limit?: number;
};

const RRF_K = 60;

function hybridInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function chunkRef(path: string, chunkIndex: number): string {
  return `${path}#${chunkIndex}`;
}

function resolveHybridLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) {
    return fallback;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    hybridInvalid("limit inválido para busca híbrida de contexto.");
  }
  return Math.floor(limit);
}

function isPathIncluded(path: string, exclusionRuleset?: ContextExclusionRuleset): boolean {
  if (!exclusionRuleset) {
    return true;
  }
  const exclusion = evaluateContextPathExclusion({
    ruleset: exclusionRuleset,
    requestedPath: path,
  });
  if ("error" in exclusion || !exclusion.included) {
    return false;
  }
  return true;
}

type ChunkMetadataRow = {
  charStart: number;
  charEnd: number;
  contentHash: string;
  lexicalText: string;
};

function readChunkMetadata(
  database: DatabaseSync,
  path: string,
  chunkIndex: number,
): ChunkMetadataRow | undefined {
  const row = database
    .prepare(
      `SELECT
         char_start AS charStart,
         char_end AS charEnd,
         content_hash AS contentHash,
         lexical_text AS lexicalText
       FROM context_file_fts
       WHERE path = ? AND chunk_index = ?`,
    )
    .get(path, chunkIndex) as ChunkMetadataRow | undefined;
  return row;
}

/**
 * Retrieval híbrido FTS5 + vetor local respeitando exclusões (CTX-02, CTX-03).
 */
export function searchHybridContextIndex(
  database: DatabaseSync,
  input: SearchHybridContextIndexInput,
): SearchContextIndexResult {
  if (!input.embeddingModel) {
    hybridInvalid("embeddingModel é obrigatório para busca híbrida de contexto.");
  }

  if (input.exclusionRuleset) {
    purgeExcludedContextIndexPaths(database, {
      exclusionRuleset: input.exclusionRuleset,
    });
  }

  const lexical = searchContextIndex(database, {
    query: input.query,
    exclusionRuleset: input.exclusionRuleset,
  });

  const vectorCandidateLimit = Math.max(lexical.hits.length, 32);
  const vectorHits = searchPersistedChunkEmbeddings(
    database,
    input.embeddingModel,
    input.query,
    vectorCandidateLimit,
    input.exclusionRuleset,
  );

  const rrfScores = new Map<string, number>();

  for (let rank = 0; rank < lexical.hits.length; rank += 1) {
    const hit = lexical.hits[rank];
    if (!hit) {
      continue;
    }
    const ref = chunkRef(hit.path, hit.chunkIndex);
    rrfScores.set(ref, (rrfScores.get(ref) ?? 0) + 1 / (RRF_K + rank + 1));
  }

  for (let rank = 0; rank < vectorHits.length; rank += 1) {
    const hit = vectorHits[rank];
    if (!hit) {
      continue;
    }
    if (!isPathIncluded(hit.path, input.exclusionRuleset)) {
      continue;
    }
    const ref = chunkRef(hit.path, hit.chunkIndex);
    rrfScores.set(ref, (rrfScores.get(ref) ?? 0) + 1 / (RRF_K + rank + 1));
  }

  const lexicalByRef = new Map<string, ContextIndexSearchHit>();
  for (const hit of lexical.hits) {
    lexicalByRef.set(chunkRef(hit.path, hit.chunkIndex), hit);
  }

  const mergedRefs = [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ref]) => ref);

  const limit = resolveHybridLimit(input.limit, mergedRefs.length);
  const hits: ContextIndexSearchHit[] = [];

  for (const ref of mergedRefs.slice(0, limit)) {
    const lexicalHit = lexicalByRef.get(ref);
    if (lexicalHit) {
      hits.push(lexicalHit);
      continue;
    }

    const hashIndex = ref.lastIndexOf("#");
    if (hashIndex <= 0) {
      continue;
    }
    const path = ref.slice(0, hashIndex);
    const chunkIndex = Number.parseInt(ref.slice(hashIndex + 1), 10);
    if (!Number.isInteger(chunkIndex)) {
      continue;
    }
    if (!isPathIncluded(path, input.exclusionRuleset)) {
      continue;
    }

    const metadata = readChunkMetadata(database, path, chunkIndex);
    if (!metadata) {
      continue;
    }

    hits.push({
      path,
      chunkIndex,
      charStart: metadata.charStart,
      charEnd: metadata.charEnd,
      contentHash: metadata.contentHash,
      lexicalSnippet: snippetFromLexicalText(metadata.lexicalText, input.query),
    });
  }

  return {
    query: input.query,
    hits,
  };
}
