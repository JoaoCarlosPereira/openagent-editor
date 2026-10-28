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
import { RunMessageQueue } from "../queue/run-message-queue.js";
import {
  consumePendingRunQueueAtRunEnd,
  enqueueRunMessage,
  removePendingRunMessage,
} from "../queue/run-queue-coordinator.js";
import { RunStateMachine } from "../state/run-state-machine.js";
import type { RunLifecycleState } from "../state/run-state.js";
import type { SessionRpcContext } from "../sessions/session-rpc-handler.js";

export type DaemonRpcContext = SessionRpcContext & {
  /** Máquinas de estado por runId na conexão (STA-01). */
  runMachines: Map<string, RunStateMachine>;
  /** Filas em memória por runId (AGT-06), sincronizadas com SQLite. */
  runQueues: Map<string, RunMessageQueue>;
};

export { consumePendingRunQueueAtRunEnd };

const RUN_STARTED_EVENT_TYPE = "run.started";
const RUN_CANCELLED_EVENT_TYPE = "run.cancelled";

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

function persistRunCompleted(db: WorkspaceDatabase, runId: string, endedAtIso: string): void {
  withSqlite(db, (sqlite) => {
    sqlite
      .prepare(`UPDATE run SET state = ?, ended_at = ? WHERE id = ?`)
      .run("completed", endedAtIso, runId);
  });
}

function persistRunCancelled(db: WorkspaceDatabase, runId: string, endedAtIso: string): void {
  withSqlite(db, (sqlite) => {
    sqlite
      .prepare(`UPDATE run SET state = ?, ended_at = ? WHERE id = ?`)
      .run("cancelled", endedAtIso, runId);
  });
}

/**
 * Encerra uma execução em andamento: consome itens pending da fila e persiste estado completed.
 * Usado pelo loop do agente ao fim de uma iteração (AGT-06).
 */
/**
 * Cancela execução em andamento: persiste `cancelled`, atualiza máquina (STA-01/PER-02)
 * e não consome itens pending da fila (sem novo dispatch).
 */
export function cancelRunningRunLifecycle(
  context: DaemonRpcContext,
  runId: string,
): { cancelled: true } {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const machine = machineForRun(context, db, runId);
    machine.cancel();
    const endedAtIso = new Date().toISOString();
    persistRunCancelled(db, runId, endedAtIso);
    const payloadBody = JSON.stringify({
      type: RUN_CANCELLED_EVENT_TYPE,
      runId,
      endedAt: endedAtIso,
    });
    const cas = db.putCasBlob(Buffer.from(payloadBody, "utf8"));
    db.appendHarnessEvent({
      runId,
      type: RUN_CANCELLED_EVENT_TYPE,
      payloadRef: cas.contentRef,
      timestamp: Date.now(),
    });
    return { cancelled: true };
  } finally {
    db.close();
  }
}

export function completeRunningRunLifecycle(
  context: DaemonRpcContext,
  runId: string,
): ReturnType<typeof consumePendingRunQueueAtRunEnd> {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const machine = machineForRun(context, db, runId);
    const consumed = consumePendingRunQueueAtRunEnd(context, runId);
    machine.complete();
    persistRunCompleted(db, runId, new Date().toISOString());
    return consumed;
  } finally {
    db.close();
  }
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
  assertRunWorkspace(context, request);

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

function assertRunWorkspace(context: DaemonRpcContext, request: RpcRequestEnvelope): void {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }
}

function handleRunCancel(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.RUN_CANCEL>,
): RpcResultMap[typeof RPC_METHOD.RUN_CANCEL] {
  assertRunWorkspace(context, request);
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.RUN_CANCEL];
  if (params.agentId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Cancelamento de subagente ainda não implementado; omita agentId para cancelar a execução.",
      [params.agentId],
    );
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const lifecycle = loadRunLifecycleState(db, request.runId);
    if (lifecycle === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "runId inexistente para run.cancel.",
        [request.runId],
      );
    }
    if (lifecycle !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "run.cancel exige execução em andamento.",
        [request.runId, lifecycle],
      );
    }
  } finally {
    db.close();
  }

  return cancelRunningRunLifecycle(context, request.runId);
}

function handleRunQueueAdd(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.RUN_QUEUE_ADD>,
): RpcResultMap[typeof RPC_METHOD.RUN_QUEUE_ADD] {
  assertRunWorkspace(context, request);
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.RUN_QUEUE_ADD];
  return enqueueRunMessage(context, request.runId, params.input);
}

function handleRunQueueRemove(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.RUN_QUEUE_REMOVE>,
): RpcResultMap[typeof RPC_METHOD.RUN_QUEUE_REMOVE] {
  assertRunWorkspace(context, request);
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.RUN_QUEUE_REMOVE];
  return removePendingRunMessage(context, request.runId, params.queueItemId);
}

export function handleRunRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  switch (request.method) {
    case RPC_METHOD.RUN_START:
      return handleRunStart(context, request as RpcRequestEnvelope<typeof RPC_METHOD.RUN_START>);
    case RPC_METHOD.RUN_CANCEL:
      return handleRunCancel(context, request as RpcRequestEnvelope<typeof RPC_METHOD.RUN_CANCEL>);
    case RPC_METHOD.RUN_QUEUE_ADD:
      return handleRunQueueAdd(
        context,
        request as RpcRequestEnvelope<typeof RPC_METHOD.RUN_QUEUE_ADD>,
      );
    case RPC_METHOD.RUN_QUEUE_REMOVE:
      return handleRunQueueRemove(
        context,
        request as RpcRequestEnvelope<typeof RPC_METHOD.RUN_QUEUE_REMOVE>,
      );
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
