import { DatabaseSync } from "node:sqlite";
import {
  COMPLETION_EVENT_TYPE,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  isProtocolError,
  type CompletionCancelResult,
  type CompletionEventPayload,
  type CompletionKind,
  type CompletionStartResult,
  type CompletionState,
  type HarnessEvent,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RPC_METHOD,
} from "@openagent/protocol";
import { openWorkspaceDatabase, sha256Hex, type WorkspaceDatabase } from "@openagent/storage";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { readCompletionSnapshot, type CompletionSnapshot } from "./completion-state.js";
import { createCliProxyCompletionSource, type CompletionTextSource } from "./completion-source.js";

export type CompletionEmit = (event: HarnessEvent, payload: CompletionEventPayload) => void;

type ActiveCompletion = {
  controller: AbortController;
  /** Resolve quando o estado terminal já foi persistido. */
  done: Promise<CompletionStartResult>;
};

/** Registro dos pedidos em voo por conexão; chave: runId + completionId. */
export type CompletionRegistry = {
  active: Map<string, ActiveCompletion>;
  defaultSource?: CompletionTextSource;
};

const registries = new WeakMap<object, CompletionRegistry>();

export function completionRegistryFor(context: DaemonRpcContext): CompletionRegistry {
  let registry = registries.get(context);
  if (!registry) {
    registry = { active: new Map() };
    registries.set(context, registry);
  }
  return registry;
}

/** Cancela tudo que ainda está em voo (conexão encerrada ou daemon em shutdown). */
export function abortAllCompletions(context: DaemonRpcContext): void {
  for (const entry of completionRegistryFor(context).active.values()) {
    entry.controller.abort();
  }
}

function activeKey(runId: string, completionId: string): string {
  return `${runId}\u0000${completionId}`;
}

function withSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

function assertRunBinding(
  context: DaemonRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope,
): void {
  if (request.workspaceId !== context.binding.workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, context.binding.workspaceId],
    );
  }
  const row = withSqlite(
    db,
    (sqlite) =>
      sqlite
        .prepare(
          `SELECT r.session_id AS sessionId FROM run r
           JOIN session s ON s.id = r.session_id
           WHERE r.id = ? AND s.deleted_at IS NULL`,
        )
        .get(request.runId) as { sessionId?: string } | undefined,
  );
  if (!row || row.sessionId !== request.sessionId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "runId inexistente ou não pertence à sessão para completion.",
      [request.runId, request.sessionId],
    );
  }
}

function persistCompletionEvent(
  db: WorkspaceDatabase,
  runId: string,
  payload: CompletionEventPayload,
): HarnessEvent {
  const cas = db.putCasBlob(Buffer.from(JSON.stringify(payload), "utf8"));
  return db.appendHarnessEvent({
    runId,
    type: payload.type,
    payloadRef: cas.contentRef,
    timestamp: Date.now(),
  });
}

function hashInput(params: RpcParamsMap[typeof RPC_METHOD.COMPLETION_START]): string {
  return sha256Hex(
    Buffer.from(
      JSON.stringify([params.prefix, params.suffix ?? "", params.language ?? "", params.kind ?? "line"]),
      "utf8",
    ),
  );
}

function resultFor(snapshot: CompletionSnapshot, replayed: boolean): CompletionStartResult {
  return {
    completionId: snapshot.completionId,
    state: snapshot.state,
    attempt: snapshot.attempt,
    ...(replayed ? { replayed: true } : {}),
  };
}

function rejectOnAbort(signal: AbortSignal): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}

function incompleteDetails(error: unknown): { code: string; reason: string } {
  if (isProtocolError(error)) {
    return { code: error.code, reason: error.message };
  }
  return {
    code: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
    reason: "Stream de completion encerrado antes do fim.",
  };
}

export type StartCompletionInput = {
  context: DaemonRpcContext;
  request: RpcRequestEnvelope<typeof RPC_METHOD.COMPLETION_START>;
  emit: CompletionEmit;
};

function resolveSource(context: DaemonRpcContext): CompletionTextSource {
  if (context.completionSource) {
    return context.completionSource;
  }
  const registry = completionRegistryFor(context);
  registry.defaultSource ??= createCliProxyCompletionSource({ dataRoot: context.dataRoot });
  return registry.defaultSource;
}

/**
 * completion.start (TAB-01): gera por stream, persiste cada evento no log append-only e
 * encerra sempre em estado terminal (completed | cancelled | incomplete).
 * Rejeita (sem persistir) pedidos inválidos ou duplicados em voo.
 */
export async function runCompletionStart(input: StartCompletionInput): Promise<CompletionStartResult> {
  const { context, request, emit } = input;
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.COMPLETION_START];
  const kind: CompletionKind = params.kind ?? "line";
  const registry = completionRegistryFor(context);
  const key = activeKey(request.runId, params.completionId);

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertRunBinding(context, db, request);

    if (registry.active.has(key)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.CONFLICT,
        "completionId já está em geração; apenas uma completion por pedido.",
        [params.completionId],
      );
    }

    const inputHash = hashInput(params);
    const snapshot = readCompletionSnapshot(db, request.runId, params.completionId);
    if (snapshot && snapshot.inputHash !== inputHash) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.CONFLICT,
        "completionId já usado com outra entrada.",
        [params.completionId],
      );
    }
    if (snapshot?.terminal && snapshot.state !== "incomplete") {
      // Replay idempotente: reapresenta o terminal persistido sem regerar nem duplicar eventos.
      emit(snapshot.terminal.event, snapshot.terminal.payload);
      return resultFor(snapshot, true);
    }

    // Retry de incomplete (ou geração interrompida sem terminal): continua do texto preservado.
    const resumeText = snapshot?.text ?? "";
    const attempt = (snapshot?.attempt ?? 0) + 1;

    const controller = new AbortController();
    let finish!: (result: CompletionStartResult) => void;
    const done = new Promise<CompletionStartResult>((resolve) => {
      finish = resolve;
    });
    registry.active.set(key, { controller, done });

    let text = resumeText;
    let terminal: CompletionStartResult | undefined;
    const settle = (state: Exclude<CompletionState, "running">, payload: CompletionEventPayload) => {
      if (terminal) {
        return;
      }
      const event = persistCompletionEvent(db, request.runId, payload);
      terminal = { completionId: params.completionId, state, attempt };
      emit(event, payload);
    };

    try {
      const started = persistCompletionEvent(db, request.runId, {
        type: COMPLETION_EVENT_TYPE.STARTED,
        completionId: params.completionId,
        attempt,
        kind,
        ...(params.language !== undefined ? { language: params.language } : {}),
        inputHash,
        resumeOffset: resumeText.length,
      });
      emit(started, {
        type: COMPLETION_EVENT_TYPE.STARTED,
        completionId: params.completionId,
        attempt,
        kind,
        ...(params.language !== undefined ? { language: params.language } : {}),
        inputHash,
        resumeOffset: resumeText.length,
      });

      const aborted = rejectOnAbort(controller.signal);
      let iterator: AsyncIterator<string> | undefined;
      try {
        const iterable = await Promise.race([
          Promise.resolve(
            resolveSource(context)({
              workspaceId: context.binding.workspaceId,
              providerProfileId: context.binding.providerProfileId,
              sessionId: request.sessionId,
              runId: request.runId,
              completionId: params.completionId,
              prefix: params.prefix,
              suffix: params.suffix ?? "",
              ...(params.language !== undefined ? { language: params.language } : {}),
              kind,
              resumeText,
              signal: controller.signal,
            }),
          ),
          aborted,
        ]);
        if (iterable !== "aborted") {
          iterator = iterable[Symbol.asyncIterator]();
          for (;;) {
            const pending = iterator.next();
            pending.catch(() => undefined);
            const step = await Promise.race([pending, aborted]);
            if (step === "aborted" || controller.signal.aborted) {
              break;
            }
            if (step.done) {
              break;
            }
            const deltaText = step.value;
            if (deltaText.length === 0) {
              continue;
            }
            const payload: CompletionEventPayload = {
              type: COMPLETION_EVENT_TYPE.DELTA,
              completionId: params.completionId,
              attempt,
              offset: text.length,
              deltaText,
            };
            const event = persistCompletionEvent(db, request.runId, payload);
            text += deltaText;
            emit(event, payload);
          }
        }
        if (controller.signal.aborted) {
          settle("cancelled", {
            type: COMPLETION_EVENT_TYPE.CANCELLED,
            completionId: params.completionId,
            attempt,
            text,
          });
        } else {
          settle("completed", {
            type: COMPLETION_EVENT_TYPE.COMPLETED,
            completionId: params.completionId,
            attempt,
            text,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          settle("cancelled", {
            type: COMPLETION_EVENT_TYPE.CANCELLED,
            completionId: params.completionId,
            attempt,
            text,
          });
        } else {
          const { code, reason } = incompleteDetails(error);
          settle("incomplete", {
            type: COMPLETION_EVENT_TYPE.INCOMPLETE,
            completionId: params.completionId,
            attempt,
            text,
            code,
            reason,
            idempotentRetry: true,
            skipRepeatedMutations: true,
          });
        }
      } finally {
        // Libera a conexão do provedor sem esperar a fonte responder (ela pode estar travada).
        controller.abort();
        void Promise.resolve(iterator?.return?.()).catch(() => undefined);
      }
    } catch (error) {
      // Falha de persistência/emissão: não deixa o pedido preso como "em voo".
      controller.abort();
      throw error;
    } finally {
      registry.active.delete(key);
      finish(terminal ?? { completionId: params.completionId, state: "incomplete", attempt });
    }
    return terminal ?? { completionId: params.completionId, state: "incomplete", attempt };
  } finally {
    db.close();
  }
}

/**
 * completion.cancel: interrompe a geração em voo e devolve o estado terminal observável.
 * Cancelar algo já terminal é idempotente (cancelled=false, estado persistido).
 */
export async function runCompletionCancel(
  context: DaemonRpcContext,
  request: RpcRequestEnvelope<typeof RPC_METHOD.COMPLETION_CANCEL>,
): Promise<CompletionCancelResult> {
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.COMPLETION_CANCEL];
  const registry = completionRegistryFor(context);
  const entry = registry.active.get(activeKey(request.runId, params.completionId));
  if (entry) {
    entry.controller.abort();
    const result = await entry.done;
    return {
      completionId: params.completionId,
      state: result.state,
      cancelled: result.state === "cancelled",
    };
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertRunBinding(context, db, request);
    const snapshot = readCompletionSnapshot(db, request.runId, params.completionId);
    if (!snapshot) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "completionId desconhecido para cancelamento.",
        [params.completionId],
      );
    }
    // Sem terminal e sem geração em voo (daemon reiniciado): o estado observável é incomplete.
    const state: CompletionState = snapshot.terminal ? snapshot.state : "incomplete";
    return { completionId: params.completionId, state, cancelled: false };
  } finally {
    db.close();
  }
}
