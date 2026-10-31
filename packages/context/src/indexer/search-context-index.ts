import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { evaluateContextPathExclusion } from "../exclusions/rules.js";
import {
  buildContextFtsMatchExpression,
  snippetFromLexicalText,
} from "./fts-query.js";
import { searchHybridContextIndex } from "../embeddings/hybrid-context-retrieval.js";
import { purgeExcludedContextIndexPaths } from "./purge-excluded-context-index.js";
import { ensureContextIndexSchema } from "./schema.js";
import type {
  ContextIndexSearchHit,
  SearchContextIndexInput,
  SearchContextIndexResult,
} from "./types.js";

function searchInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptyQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0) {
    searchInvalid("query inválida para busca.");
  }
}

type FtsRow = {
  path: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  contentHash: string;
  lexicalText: string;
};

/**
 * Busca lexical no índice FTS5 de arquivos do workspace (CTX-02).
 */
export function searchContextIndex(
  database: DatabaseSync,
  input: SearchContextIndexInput,
): SearchContextIndexResult {
  ensureContextIndexSchema(database);
  requireNonEmptyQuery(input.query);

  if (input.embeddingModel) {
    return searchHybridContextIndex(database, {
      query: input.query,
      exclusionRuleset: input.exclusionRuleset,
      embeddingModel: input.embeddingModel,
      limit: input.limit,
    });
  }

  if (input.exclusionRuleset) {
    purgeExcludedContextIndexPaths(database, {
      exclusionRuleset: input.exclusionRuleset,
    });
  }

  const matchExpression = buildContextFtsMatchExpression(input.query);
  let ftsRows: FtsRow[];
  try {
    ftsRows = database
      .prepare(
        `SELECT
          path,
          chunk_index AS chunkIndex,
          char_start AS charStart,
          char_end AS charEnd,
          content_hash AS contentHash,
          lexical_text AS lexicalText
        FROM context_file_fts
        WHERE context_file_fts MATCH ?
        ORDER BY path, chunk_index`,
      )
      .all(matchExpression) as FtsRow[];
  } catch {
    searchInvalid("query inválida para busca FTS.");
  }

  const hits: ContextIndexSearchHit[] = [];
  for (const row of ftsRows) {
    if (input.exclusionRuleset) {
      const exclusion = evaluateContextPathExclusion({
        ruleset: input.exclusionRuleset,
        requestedPath: row.path,
      });
      if ("error" in exclusion || !exclusion.included) {
        continue;
      }
    }
    hits.push({
      path: row.path,
      chunkIndex: row.chunkIndex,
      charStart: row.charStart,
      charEnd: row.charEnd,
      contentHash: row.contentHash,
      lexicalSnippet: snippetFromLexicalText(row.lexicalText, input.query),
    });
  }

  return {
    query: input.query,
    hits,
  };
}
