import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateUserInput,
  type UserInput,
} from "@openagent/protocol";
import {
  openWorkspaceDatabase,
  type WorkspaceDatabase,
} from "@openagent/storage";
import type { RunLifecycleState } from "../state/run-state.js";
import type { WorkspaceBindingState } from "../workspace-state.js";
import { RunMessageQueue, type RunQueueItem } from "./run-message-queue.js";

export type RunQueueHostContext = {
  dataRoot: string;
  binding: WorkspaceBindingState;
  runQueues: Map<string, RunMessageQueue>;
};

function withSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
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

function parseQueuePayload(db: WorkspaceDatabase, payloadRef: string): UserInput {
  const bytes = db.readCasBlob(payloadRef);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "payloadRef da fila inválido.");
  }
  const record = parsed as { input?: unknown };
  const inputResult = validateUserInput(record.input);
  if (!inputResult.valid) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, inputResult.errors.join(" "));
  }
  return inputResult.value;
}

function markQueueItemStartedInDb(
  db: WorkspaceDatabase,
  runId: string,
  queueItemId: string,
): void {
  withSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare("SELECT id, state FROM queue_item WHERE id = ? AND run_id = ?")
      .get(queueItemId, runId) as { id?: string; state?: string } | undefined;
    if (row?.id !== queueItemId) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "item de fila inexistente.", [
        queueItemId,
      ]);
    }
    if (row.state === "started") {
      return;
    }
    if (row.state !== "pending") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "item de fila em estado inválido para consumo.",
        [queueItemId, row.state ?? "desconhecido"],
      );
    }
    sqlite
      .prepare("UPDATE queue_item SET state = ? WHERE id = ?")
      .run("started", queueItemId);
  });
}

function ensureRunQueue(context: RunQueueHostContext, db: WorkspaceDatabase, runId: string): RunMessageQueue {
  let queue = context.runQueues.get(runId);
  if (queue) {
    return queue;
  }
  queue = new RunMessageQueue();
  for (const stored of db.listQueueItems(runId)) {
    if (stored.state !== "pending") {
      continue;
    }
    queue.restorePersistedPending({
      queueItemId: stored.id,
      runId: stored.runId,
      ordinal: stored.ordinal,
      input: parseQueuePayload(db, stored.payloadRef),
      state: "pending",
    });
  }
  context.runQueues.set(runId, queue);
  return queue;
}

function persistQueueItem(
  db: WorkspaceDatabase,
  item: RunQueueItem,
): void {
  const payloadBody = JSON.stringify({ input: item.input });
  const cas = db.putCasBlob(Buffer.from(payloadBody, "utf8"));
  db.insertQueueItem({
    id: item.queueItemId,
    runId: item.runId,
    ordinal: item.ordinal,
    payloadRef: cas.contentRef,
    state: item.state,
  });
}

export function enqueueRunMessage(
  context: RunQueueHostContext,
  runId: string,
  input: unknown,
): { queueItemId: string; ordinal: number } {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const lifecycle = loadRunLifecycleState(db, runId);
    if (lifecycle !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Fila editável somente enquanto a execução está em andamento.",
      );
    }

    const queue = ensureRunQueue(context, db, runId);
    const item = queue.enqueue({
      runLifecycleState: lifecycle,
      runId,
      input,
    });
    persistQueueItem(db, item);
    return { queueItemId: item.queueItemId, ordinal: item.ordinal };
  } finally {
    db.close();
  }
}

export function removePendingRunMessage(
  context: RunQueueHostContext,
  runId: string,
  queueItemId: string,
): { removed: true } {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const lifecycle = loadRunLifecycleState(db, runId);
    if (lifecycle !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Fila editável somente enquanto a execução está em andamento.",
      );
    }

    const queue = ensureRunQueue(context, db, runId);
    queue.removePending(queueItemId, lifecycle);
    db.removePendingQueueItem(runId, queueItemId);
    return { removed: true };
  } finally {
    db.close();
  }
}

/** Marca itens pending como started ao fim da execução (consumo da fila). */
export function consumePendingRunQueueAtRunEnd(
  context: RunQueueHostContext,
  runId: string,
): readonly RunQueueItem[] {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const lifecycle = loadRunLifecycleState(db, runId);
    if (lifecycle !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Consumo de fila exige execução em andamento.",
      );
    }

    const queue = ensureRunQueue(context, db, runId);
    const pending = [...queue.pendingInOrder()];
    for (const item of pending) {
      queue.markStarted(item.queueItemId);
      markQueueItemStartedInDb(db, runId, item.queueItemId);
    }
    return pending;
  } finally {
    db.close();
  }
}
