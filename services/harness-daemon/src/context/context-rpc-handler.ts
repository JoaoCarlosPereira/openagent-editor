import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";
import { executeContextAttachRpc } from "@openagent/context";
import { openWorkspaceDatabase } from "@openagent/storage";
import type { SessionRpcContext } from "../sessions/session-rpc-handler.js";

function readWorkspaceContextLimit(
  sqlite: DatabaseSync,
  workspaceId: string,
): number | null {
  const row = sqlite
    .prepare(`SELECT context_limit AS contextLimit FROM workspace WHERE id = ?`)
    .get(workspaceId) as { contextLimit: number } | undefined;
  return row?.contextLimit ?? null;
}

export function dispatchContextRpc(
  context: SessionRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[typeof RPC_METHOD.CONTEXT_ATTACH] {
  if (request.method !== RPC_METHOD.CONTEXT_ATTACH) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Método RPC não implementado em context: ${String(request.method)}`,
    );
  }

  const { workspaceId } = context.binding;
  if (request.workspaceId !== workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, workspaceId],
    );
  }

  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.CONTEXT_ATTACH];
  const db = openWorkspaceDatabase({ dataRoot: context.dataRoot, workspaceId });
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    const workspaceContextLimitTokens = readWorkspaceContextLimit(sqlite, workspaceId);
    return executeContextAttachRpc(params, { workspaceContextLimitTokens });
  } finally {
    sqlite.close();
    db.close();
  }
}
