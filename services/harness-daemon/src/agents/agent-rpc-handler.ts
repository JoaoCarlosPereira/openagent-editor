import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type RpcMethod,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { handleAgentCancel } from "./agent-cancel.js";
import { handleAgentSpawn } from "./agent-spawn.js";

function mapProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

function assertAgentWorkspace(context: DaemonRpcContext, request: RpcRequestEnvelope): void {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }
  if (typeof request.runId !== "string" || request.runId.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "runId obrigatório para RPC de agente.",
    );
  }
}

export function handleAgentRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  assertAgentWorkspace(context, request);

  switch (request.method) {
    case RPC_METHOD.AGENT_SPAWN: {
      const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.AGENT_SPAWN];
      return handleAgentSpawn(context, request.runId, params);
    }
    case RPC_METHOD.AGENT_CANCEL: {
      const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.AGENT_CANCEL];
      return handleAgentCancel(context, request.runId, params);
    }
    default:
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método agent RPC não implementado: ${String(request.method)}`,
      );
  }
}

export function dispatchAgentRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  try {
    return handleAgentRpc(context, request);
  } catch (error) {
    throw mapProtocolError(error);
  }
}
