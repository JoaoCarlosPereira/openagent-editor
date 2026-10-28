import type { DatabaseSync } from "node:sqlite";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type ContextIndexParams,
  type RpcResultMap,
} from "@openagent/protocol";

import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { reindexContextFileOnSave } from "../indexer/reindex-context-file-on-save.js";

export interface ExecuteContextIndexRpcOptions {
  workspaceRoot: string;
  exclusionRuleset?: ContextExclusionRuleset;
}

function indexRpcInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

/**
 * Implementação de context.index: reindexação incremental dos paths salvos (CTX-02).
 */
export function executeContextIndexRpc(
  database: DatabaseSync,
  params: ContextIndexParams,
  options: ExecuteContextIndexRpcOptions,
): RpcResultMap[typeof RPC_METHOD.CONTEXT_INDEX] {
  if (typeof options.workspaceRoot !== "string" || !options.workspaceRoot.trim()) {
    indexRpcInvalid("workspaceRoot inválido para context.index.");
  }

  const paths = params.paths;
  if (paths === undefined) {
    indexRpcInvalid("Campo 'paths' é obrigatório para context.index.");
  }
  if (!Array.isArray(paths) || paths.length === 0) {
    indexRpcInvalid("Campo 'paths' deve ser array não-vazio.");
  }
  for (const entry of paths) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      indexRpcInvalid("Campo 'paths' deve conter apenas strings não-vazias.");
    }
  }

  let indexed = 0;
  for (const relativePath of paths) {
    const result = reindexContextFileOnSave(database, {
      workspaceRoot: options.workspaceRoot,
      relativePath,
      exclusionRuleset: options.exclusionRuleset,
    });
    if (result.indexed) {
      indexed += 1;
    }
  }

  return { indexed };
}
