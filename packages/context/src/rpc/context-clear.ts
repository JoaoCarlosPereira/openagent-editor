import type { DatabaseSync } from "node:sqlite";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type ContextClearParams,
  type RpcResultMap,
} from "@openagent/protocol";

import { clearWorkspaceContextIndex } from "../indexer/clear-context-index.js";

function clearRpcInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

/**
 * Implementação de context.clear: informa escopo/tamanho e apaga índice local (CTX-04).
 */
export function executeContextClearRpc(
  database: DatabaseSync,
  params: ContextClearParams,
): RpcResultMap[typeof RPC_METHOD.CONTEXT_CLEAR] {
  const scope = params.scope ?? "workspace";
  if (scope !== "workspace") {
    clearRpcInvalid(
      "Limpeza do índice de contexto só está disponível com escopo 'workspace'.",
      [scope],
    );
  }

  const cleared = clearWorkspaceContextIndex(database);
  return {
    cleared: true,
    scope: cleared.scope,
    size: cleared.size,
  };
}
