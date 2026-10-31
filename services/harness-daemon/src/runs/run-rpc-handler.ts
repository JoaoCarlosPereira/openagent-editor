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
import { persistHarnessEventWithPayload } from "@openagent/policy";
import { openWorkspaceDatabase, type WorkspaceDatabase } from "@openagent/storage";
import { runAgentModeIfRequested } from "../agent/agent-mode-run.js";
import { executeAskRunLoop } from "../agent/ask-run-loop.js";
import { tryExtractAskLoopPlanFromUserText } from "../agent/ask-loop-plan.js";
import {
  tryExtractPlanAcceptBundleFromUserText,
  tryExtractPlanDraftFromUserText,
} from "../agent/plan-mode-input.js";
import { executePlanAcceptedRun, presentPlanDraftRun } from "../agent/plan-run-loop.js";
import { RunMessageQueue } from "../queue/run-message-queue.js";
import {
  consumePendingRunQueueAtRunEnd,
  enqueueRunMessage,
  removePendingRunMessage,
} from "../queue/run-queue-coordinator.js";
import { RunStateMachine } from "../state/run-state-machine.js";
import type { RunLifecycleState } from "../state/run-state.js";
import type { SessionRpcContext } from "../sessions/session-rpc-handler.js";
import type { RunGrantRegistryMap } from "../agents/agent-subagent-grants.js";
import type { SubagentRuntimeRegistry } from "../agents/agent-subagent-runtime.js";
import { BrowserSessionRegistry } from "./browser-session-registry.js";
import type { CompletionTextSource } from "../completion/completion-source.js";

export type DaemonRpcContext = SessionRpcContext & {
  /** Máquinas de estado por runId na conexão (STA-01). */
  runMachines: Map<string, RunStateMachine>;
  /** Filas em memória por runId (AGT-06), sincronizadas com SQLite. */
  runQueues: Map<string, RunMessageQueue>;
  /** Sessões de navegador autorizado ativas por runId na conexão (AUT-01). */
  browserSessions: BrowserSessionRegistry;
  /** Subagentes em execução por runId (AGT-07). */
  subagentRuns?: SubagentRuntimeRegistry;
  /** Grants do run pai compartilhados com subagentes (AGT-05 / PER-01). */
  runGrantRegistries?: RunGrantRegistryMap;
  /** Fonte de texto do completion (TAB-01); omitida usa o CLIProxyAPI do perfil do workspace. */
  completionSource?: CompletionTextSource;
};

export { consumePendingRunQueueAtRunEnd };

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

function persistRunCompleted(db: WorkspaceDatabase, runId: string, endedAtIso: string): void {
  withSqlite(db, (sqlite) => {
    sqlite
      .prepare(`UPDATE run SET state = ?, ended_at = ? WHERE id = ?`)
      .run("completed", endedAtIso, runId);
  });
}

/**
 * Encerra uma execução em andamento: consome itens pending da fila e persiste estado completed.
 * Usado pelo loop do agente ao fim de uma iteração (AGT-06).
 */
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

    const startedEvent = db.appendHarnessEvent({
      runId: request.runId,
      type: RUN_STARTED_EVENT_TYPE,
      payloadRef: cas.contentRef,
      timestamp,
    });

    const runMode = params.mode ?? context.binding.mode;
    runAgentModeIfRequested({
      context,
      db,
      sessionId: request.sessionId,
      runId: request.runId,
      runMode,
      workspaceRoot: context.binding.workspaceRoot,
      userInputText: inputResult.value.text,
      machine,
    });

    const askLoopPlan = tryExtractAskLoopPlanFromUserText(inputResult.value.text);
    if (runMode === "ask" && askLoopPlan) {
      executeAskRunLoop({
        context,
        db,
        sessionId: request.sessionId,
        runId: request.runId,
        workspaceRoot: context.binding.workspaceRoot,
        plan: askLoopPlan,
        machine,
      });
    }

    const planDraft = tryExtractPlanDraftFromUserText(inputResult.value.text);
    if (runMode === "plan" && planDraft) {
      presentPlanDraftRun({
        context,
        db,
        sessionId: request.sessionId,
        runId: request.runId,
        draft: planDraft,
        machine,
      });
    } else if (runMode === "plan") {
      const planAcceptBundle = tryExtractPlanAcceptBundleFromUserText(inputResult.value.text);
      if (planAcceptBundle) {
        executePlanAcceptedRun({
          context,
          db,
          sessionId: request.sessionId,
          runId: request.runId,
          workspaceRoot: context.binding.workspaceRoot,
          accept: planAcceptBundle.accept,
          agentLoop: planAcceptBundle.agentLoop,
          machine,
        });
      }
    }

    return startedEvent;
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

async function handleRunCancel(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.RUN_CANCEL>,
): Promise<RpcResultMap[typeof RPC_METHOD.RUN_CANCEL]> {
  assertRunWorkspace(context, request);
  if (request.payload?.agentId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Cancelamento de subagente não é suportado.",
    );
  }
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const updated = withSqlite(db, (sqlite) =>
      sqlite
        .prepare(
          "UPDATE run SET state = 'cancelled', ended_at = ? WHERE id = ? AND session_id = ? AND state = 'running'",
        )
        .run(new Date().toISOString(), request.runId, request.sessionId).changes,
    );
    if (updated !== 1) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Execução inexistente, terminal ou de outra sessão.",
      );
    }
    context.runMachines.set(request.runId, new RunStateMachine("cancelled"));
    // AUT-01 + ADR-006: cancelamento da run encerra o worker do navegador e impede novos dispatches.
    const browserClosed = await context.browserSessions.closeForRun(request.runId);
    if (browserClosed) {
      persistHarnessEventWithPayload(db, request.runId, "browser.cancelled", {
        type: "browser.cancelled",
        runId: request.runId,
        sessionId: request.sessionId,
      });
    }
    return { cancelled: true };
  } finally {
    db.close();
  }
}

export async function handleRunRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): Promise<RpcResultMap[RpcMethod]> {
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

export async function dispatchRunRpc(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope,
): Promise<RpcResultMap[RpcMethod]> {
  try {
    return await handleRunRpc(context, request);
  } catch (error) {
    throw mapProtocolError(error);
  }
}
