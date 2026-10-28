import type { DatabaseSync } from "node:sqlite";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type ContextSearchParams,
  type RpcResultMap,
} from "@openagent/protocol";

import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { resolveContextExclusionRuleset } from "../exclusions/rules.js";
import { searchContextIndex } from "../indexer/search-context-index.js";

export interface ExecuteContextSearchRpcOptions {
  workspaceRoot: string;
  exclusionRuleset?: ContextExclusionRuleset;
  workspaceExclusionPatterns?: unknown;
}

function searchRpcInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function resolveSearchExclusionRuleset(
  options: ExecuteContextSearchRpcOptions,
): ContextExclusionRuleset {
  if (options.exclusionRuleset) {
    return options.exclusionRuleset;
  }
  return resolveContextExclusionRuleset({
    workspaceRoot: options.workspaceRoot,
    workspaceExclusionPatterns: options.workspaceExclusionPatterns ?? [],
  });
}

/**
 * Implementação de context.search: busca lexical omitindo caminhos excluídos (CTX-03).
 */
export function executeContextSearchRpc(
  database: DatabaseSync,
  params: ContextSearchParams,
  options: ExecuteContextSearchRpcOptions,
): RpcResultMap[typeof RPC_METHOD.CONTEXT_SEARCH] {
  if (typeof options.workspaceRoot !== "string" || !options.workspaceRoot.trim()) {
    searchRpcInvalid("workspaceRoot inválido para context.search.");
  }

  const query = params.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    searchRpcInvalid("Campo 'query' é obrigatório para context.search.");
  }

  const exclusionRuleset = resolveSearchExclusionRuleset(options);
  const searchResult = searchContextIndex(database, {
    query,
    exclusionRuleset,
  });

  const limit =
    params.limit !== undefined && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : searchResult.hits.length;

  const hits = searchResult.hits.slice(0, limit).map((hit, index) => ({
    ref: `${hit.path}#${hit.chunkIndex}`,
    score: searchResult.hits.length - index,
  }));

  return { hits };
}
