import type net from "node:net";
import {
  buildHarnessRpcOkFrame,
  buildProtocolTransportErrorFrame,
  isRpcMethod,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  readProtocolFrame,
  RPC_METHOD,
  validateRpcRequest,
  writeProtocolFrame,
  type ProtocolErrorCode,
  type RpcRequestEnvelope,
} from "@openagent/protocol";
import { dispatchAgentRpc } from "./agents/agent-rpc-handler.js";
import { dispatchCheckpointRpc } from "./checkpoints/checkpoint-rpc-handler.js";
import { dispatchContextRpc } from "./context/context-rpc-handler.js";
import { dispatchProjectRpc } from "./projects/project-rpc-handler.js";
import { dispatchRunRpc, type DaemonRpcContext } from "./runs/run-rpc-handler.js";
import { dispatchSessionRpc } from "./sessions/session-rpc-handler.js";

const SESSION_RPC_METHODS = new Set<string>([
  RPC_METHOD.SESSION_CREATE,
  RPC_METHOD.SESSION_LIST,
  RPC_METHOD.SESSION_SEARCH,
  RPC_METHOD.SESSION_EXPORT,
  RPC_METHOD.SESSION_DELETE,
  RPC_METHOD.SESSION_FORK,
]);

const RUN_RPC_METHODS = new Set<string>([
  RPC_METHOD.RUN_START,
  RPC_METHOD.RUN_QUEUE_ADD,
  RPC_METHOD.RUN_QUEUE_REMOVE,
]);

const CHECKPOINT_RPC_METHODS = new Set<string>([
  RPC_METHOD.CHECKPOINT_CREATE,
  RPC_METHOD.CHECKPOINT_RESTORE,
]);

const CONTEXT_RPC_METHODS = new Set<string>([RPC_METHOD.CONTEXT_ATTACH]);

const AGENT_RPC_METHODS = new Set<string>([
  RPC_METHOD.AGENT_SPAWN,
  RPC_METHOD.AGENT_CANCEL,
]);

const PROJECT_RPC_METHODS = new Set<string>([
  RPC_METHOD.PROJECT_CREATE,
  RPC_METHOD.PROJECT_ACCEPT,
  RPC_METHOD.PROJECT_REJECT,
]);

function writeProtocolError(socket: net.Socket, code: ProtocolErrorCode, message: string): void {
  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(buildProtocolTransportErrorFrame(code, message)), "utf8"),
  );
}

export async function serveRpcOnConnection(
  socket: net.Socket,
  context: DaemonRpcContext,
): Promise<void> {
  while (!socket.destroyed) {
    let frame: Buffer;
    try {
      frame = await readProtocolFrame(socket);
    } catch {
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.toString("utf8")) as unknown;
    } catch {
      writeProtocolError(
        socket,
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Frame RPC não é JSON válido.",
      );
      break;
    }

    const validation = validateRpcRequest(parsed);
    if (!validation.valid) {
      writeProtocolError(socket, validation.code, validation.errors.join(" "));
      continue;
    }

    const request = validation.value as RpcRequestEnvelope;
    if (!isRpcMethod(request.method)) {
      writeProtocolError(
        socket,
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método RPC não suportado nesta conexão: ${String(request.method)}`,
      );
      continue;
    }

    const isSession = SESSION_RPC_METHODS.has(request.method);
    const isRun = RUN_RPC_METHODS.has(request.method);
    const isCheckpoint = CHECKPOINT_RPC_METHODS.has(request.method);
    const isContext = CONTEXT_RPC_METHODS.has(request.method);
    const isAgent = AGENT_RPC_METHODS.has(request.method);
    const isProject = PROJECT_RPC_METHODS.has(request.method);
    if (!isSession && !isRun && !isCheckpoint && !isContext && !isAgent && !isProject) {
      writeProtocolError(
        socket,
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método RPC não suportado nesta conexão: ${String(request.method)}`,
      );
      continue;
    }

    try {
      const result = isRun
        ? dispatchRunRpc(context, request)
        : isCheckpoint
          ? dispatchCheckpointRpc(context, request)
          : isContext
            ? dispatchContextRpc(context, request)
            : isAgent
              ? dispatchAgentRpc(context, request)
              : isProject
                ? dispatchProjectRpc(context, request)
                : dispatchSessionRpc(context, request);
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(buildHarnessRpcOkFrame(request.requestId, result)),
          "utf8",
        ),
      );
    } catch (error) {
      const code =
        error instanceof ProtocolError
          ? error.code
          : PROTOCOL_ERROR_CODES.INVALID_STATE;
      const message = error instanceof Error ? error.message : String(error);
      writeProtocolError(socket, code, message);
    }
  }
}
