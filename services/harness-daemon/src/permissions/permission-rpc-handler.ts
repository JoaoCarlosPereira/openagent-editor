import {
  RPC_METHOD,
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  type PermissionDecideParams,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";

import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { getPermissionService } from "./permission-service.js";

export function dispatchPermissionDecide(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[typeof RPC_METHOD.PERMISSION_DECIDE] {
  if (request.method !== RPC_METHOD.PERMISSION_DECIDE || request.payload === undefined) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Payload permission.decide ausente.",
    );
  }
  const service = getPermissionService(context.dataRoot, context.binding.workspaceId);
  const result = service.decide(request.payload as PermissionDecideParams, {
    sessionId: request.sessionId,
    workspaceId: request.workspaceId,
  });
  return { persisted: result.persisted };
}
