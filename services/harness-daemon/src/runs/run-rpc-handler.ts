import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  validateUserInput,
  type RpcMethod,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";
import { openWorkspaceDatabase, type WorkspaceDatabase } from "@openagent/storage";
import { RunStateMachine } from "../state/run-state-machine.js";
import type { RunLifecycleState } from "../state/run-state.js";
import type { SessionRpcContext } from "../sessions/session-rpc-handler.js";

export type DaemonRpcContext = SessionRpcContext & {
  /** Máquinas de estado por runId na conexão (STA-01). */
  runMachines: Map<string, RunStateMachine>;
};

const RUN_STARTED_EVENT_TYPE = "run.started";

function mapProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

function withSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

function sessionExists(db: WorkspaceDatabase, sessionId: string): boolean {
  return withSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare("SELECT id FROM session WHERE id = ? AND deleted_at IS NULL")
      .get(sessionId) as { id?: string } | undefined;
    return row?.id === sessionId;
  });
}

function loadRunLifecycleState(db: WorkspaceDatabase, runId: string): RunLifecycleState | null {
  return withSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare("SELECT state FROM run WHERE id = ?")
      .get(runId) as { state?: string } | undefined;
    if (!row?.state) {
      return null;
    }
    if (
      row.state === "idle" ||
      row.state === "running" ||
      row.state === "completed" ||
      row.state === "cancelled"
    ) {
      return row.state;
    }
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Estado de run persistido inválido: ${row.state}`,
    );
  });
}

function persistRunStart(
  db: WorkspaceDatabase,
  sessionId: string,
  runId: string,
  startedAtIso: string,
): void {
  withSqlite(db, (sqlite) => {
    sqlite
      .prepare(
        `INSERT INTO run(id, session_id, state, started_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(runId, sessionId, "running", startedAtIso);
  });
}

function machineForRun(context: DaemonRpcContext, db: WorkspaceDatabase, runId: string): RunStateMachine {
  let machine = context.runMachines.get(runId);
  if (machine) {
    return machine;
  }
  const persisted = loadRunLifecycleState(db, runId);
  machine = new RunStateMachine(persisted ?? "idle");
  context.runMachines.set(runId, machine);
  return machine;
}

export function handleRunStart(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.RUN_START>,
): RpcResultMap[typeof RPC_METHOD.RUN_START] {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }

  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.RUN_START];
  const inputResult = validateUserInput(params.input);
  if (!inputResult.valid) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, inputResult.errors.join(" "));
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    if (!sessionExists(db, request.sessionId)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "sessionId inexistente para run.start.",
        [request.sessionId],
      );
    }

    if (loadRunLifecycleState(db, request.runId) !== null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "runId já existe para run.start.",
        [request.runId],
      );
    }

    const machine = machineForRun(context, db, request.runId);
    try {
      machine.start();
    } catch (error) {
      throw mapProtocolError(error);
    }

    const startedAtIso = new Date().toISOString();
    const timestamp = Date.now();
    const payloadBody = JSON.stringify({
      type: RUN_STARTED_EVENT_TYPE,
      sessionId: request.sessionId,
      mode: params.mode ?? context.binding.mode,
      input: inputResult.value,
    });
    const cas = db.putCasBlob(Buffer.from(payloadBody, "utf8"));

    persistRunStart(db, request.sessionId, request.runId, startedAtIso);

    return db.appendHarnessEvent({
      runId: request.runId,
      type: RUN_STARTED_EVENT_TYPE,
      payloadRef: cas.contentRef,
      timestamp,
    });
  } finally {
    db.close();
  }
}

export function handleRunRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  switch (request.method) {
    case RPC_METHOD.RUN_START:
      return handleRunStart(context, request as RpcRequestEnvelope<typeof RPC_METHOD.RUN_START>);
    default:
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Método run RPC não implementado: ${String(request.method)}`,
      );
  }
}

export function dispatchRunRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  try {
    return handleRunRpc(context, request);
  } catch (error) {
    throw mapProtocolError(error);
  }
}
