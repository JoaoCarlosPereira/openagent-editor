import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type RpcMethod,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";
import {
  createStoredCheckpoint,
  loadCheckpointRestorePayload,
  openWorkspaceDatabase,
} from "@openagent/storage";
import { restoreCheckpointOnWorkspace } from "@openagent/tools";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveCasRoot(databasePath: string): string {
  return join(dirname(databasePath), "cas");
}

function mapProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

function assertCheckpointWorkspace(context: DaemonRpcContext, request: RpcRequestEnvelope): void {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }
  if (!isNonEmptyString(request.runId)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "runId obrigatório para checkpoint.create.",
    );
  }
}

export function handleCheckpointRestore(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.CHECKPOINT_RESTORE>,
): RpcResultMap[typeof RPC_METHOD.CHECKPOINT_RESTORE] {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }

  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.CHECKPOINT_RESTORE];
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const sqlite = new DatabaseSync(db.databasePath);
    try {
      const loaded = loadCheckpointRestorePayload(
        sqlite,
        resolveCasRoot(db.databasePath),
        params.checkpointId,
      );
      const outcome = restoreCheckpointOnWorkspace(context.binding.workspaceRoot, {
        baseHashes: loaded.baseHashes,
        resultHashes: loaded.resultHashes,
        patchText: loaded.patchText,
      });
      if ("conflict" in outcome) {
        return { conflict: true };
      }
      return { restored: true };
    } finally {
      sqlite.close();
    }
  } finally {
    db.close();
  }
}

export function handleCheckpointCreate(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.CHECKPOINT_CREATE>,
): RpcResultMap[typeof RPC_METHOD.CHECKPOINT_CREATE] {
  assertCheckpointWorkspace(context, request);

  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.CHECKPOINT_CREATE];
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const sqlite = new DatabaseSync(db.databasePath);
    try {
      const created = createStoredCheckpoint(sqlite, resolveCasRoot(db.databasePath), {
        runId: request.runId,
        label: params.label,
        baseHashes: params.baseHashes,
        resultHashes: params.resultHashes,
        patchText: params.patchText,
      });
      return { checkpointId: created.checkpointId };
    } finally {
      sqlite.close();
    }
  } finally {
    db.close();
  }
}

export function handleCheckpointRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  switch (request.method) {
    case RPC_METHOD.CHECKPOINT_CREATE:
      return handleCheckpointCreate(
        context,
        request as RpcRequestEnvelope<typeof RPC_METHOD.CHECKPOINT_CREATE>,
      );
    case RPC_METHOD.CHECKPOINT_RESTORE:
      return handleCheckpointRestore(
        context,
        request as RpcRequestEnvelope<typeof RPC_METHOD.CHECKPOINT_RESTORE>,
      );
    default:
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método checkpoint RPC não implementado: ${String(request.method)}`,
      );
  }
}

export function dispatchCheckpointRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  try {
    return handleCheckpointRpc(context, request);
  } catch (error) {
    throw mapProtocolError(error);
  }
}
