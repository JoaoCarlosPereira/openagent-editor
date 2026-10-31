import type net from "node:net";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  buildHarnessEventFrame,
  buildHarnessRpcOkFrame,
  buildProtocolTransportErrorFrame,
  buildRpcStreamEndFrame,
  writeProtocolFrame,
  type RpcRequestEnvelope,
} from "@openagent/protocol";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { runCompletionCancel, runCompletionStart } from "./completion-service.js";

export const COMPLETION_RPC_METHODS = new Set<string>([
  RPC_METHOD.COMPLETION_START,
  RPC_METHOD.COMPLETION_CANCEL,
]);

function writeJson(socket: net.Socket, body: unknown): void {
  if (socket.destroyed || !socket.writable) {
    return;
  }
  writeProtocolFrame(socket, Buffer.from(JSON.stringify(body), "utf8"));
}

function writeRequestError(socket: net.Socket, requestId: string, error: unknown): void {
  const code = error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE;
  const message = error instanceof Error ? error.message : String(error);
  writeJson(socket, buildProtocolTransportErrorFrame(code, message, requestId));
}

/**
 * Despacha completion.* sem bloquear o laço de leitura da conexão: o cancelamento precisa
 * ser lido enquanto a geração ainda está em andamento. Devolve a promessa da operação.
 */
export function dispatchCompletionRpc(
  socket: net.Socket,
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): Promise<void> {
  if (request.method === RPC_METHOD.COMPLETION_START) {
    return runCompletionStart({
      context,
      request: request as RpcRequestEnvelope<typeof RPC_METHOD.COMPLETION_START>,
      emit: (event, payload) =>
        writeJson(socket, buildHarnessEventFrame(request.requestId, event, payload)),
    }).then(
      (result) => writeJson(socket, buildRpcStreamEndFrame(request.requestId, result)),
      (error: unknown) => writeRequestError(socket, request.requestId, error),
    );
  }
  return runCompletionCancel(
    context,
    request as RpcRequestEnvelope<typeof RPC_METHOD.COMPLETION_CANCEL>,
  ).then(
    (result) => writeJson(socket, buildHarnessRpcOkFrame(request.requestId, result)),
    (error: unknown) => writeRequestError(socket, request.requestId, error),
  );
}
