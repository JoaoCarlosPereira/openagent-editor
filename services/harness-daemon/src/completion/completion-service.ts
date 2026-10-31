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
import { redactProviderCredentials } from "@openagent/model-gateway";

export type CompletionEmit = (event: HarnessEvent, payload: CompletionEventPayload) => void;

type ActiveCompletion = {
  controller: AbortController;
  /** Conexão que iniciou a geração; só ela é abortada quando fecha. */
  owner: object;
  /** Resolve quando o estado terminal já foi persistido. */
  done: Promise<CompletionStartResult>;
};

/**
 * Gerações em voo compartilhadas por todas as conexões do daemon: a unicidade e o cancelamento
 * valem por workspace + run + completionId, não por conexão.
 */
const activeCompletions = new Map<string, ActiveCompletion>();

/** Aborta as gerações iniciadas por esta conexão (conexão encerrada ou daemon em shutdown). */
export function abortAllCompletions(context: DaemonRpcContext): void {
  for (const entry of activeCompletions.values()) {
    if (entry.owner === context) {
      entry.controller.abort();
    }
  }
}

function activeKey(context: DaemonRpcContext, runId: string, completionId: string): string {
  return [context.dataRoot, context.binding.workspaceId, runId, completionId].join("\u0000");
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

function abortSignalPromise(signal: AbortSignal): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}

/** Só falhas do gateway/provedor ou stream interrompido permitem retry idempotente. */
function isRetryableCompletionError(error: unknown): boolean {
  if (!isProtocolError(error)) {
    return false;
  }
  return error.code === PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM || error.code.startsWith("PROVIDER_");
}

function incompleteDetails(error: unknown): { code: string; reason: string } {
  if (isProtocolError(error)) {
    const stableReasons: Record<string, string> = {
      [PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM]: "Stream de completion encerrado antes do fim.",
    };
    const reason = error.code.startsWith("PROVIDER_")
      ? `Falha do provedor (${error.code}).`
      : (stableReasons[error.code] ?? "Completion interrompida.");
    return { code: error.code, reason: redactProviderCredentials(reason) };
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

const defaultSources = new Map<string, CompletionTextSource>();

function resolveSource(context: DaemonRpcContext): CompletionTextSource {
  if (context.completionSource) {
    return context.completionSource;
  }
  let source = defaultSources.get(context.dataRoot);
  if (!source) {
    source = createCliProxyCompletionSource({ dataRoot: context.dataRoot });
    defaultSources.set(context.dataRoot, source);
  }
  return source;
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
  const key = activeKey(context, request.runId, params.completionId);

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertRunBinding(context, db, request);

    if (activeCompletions.has(key)) {
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
    activeCompletions.set(key, { controller, owner: context, done });

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

      const aborted = abortSignalPromise(controller.signal);
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
        } else if (isRetryableCompletionError(error)) {
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
        } else {
          // Erros de configuração/estado são estáveis: não criar started nem terminal retryable.
          throw error;
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
      activeCompletions.delete(key);
      finish(terminal ?? { completionId: params.completionId, state: "incomplete", attempt });
    }
    return done;
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
  // Validar o vínculo antes de consultar gerações globais: pedidos divergentes nunca abortam.
  const bindingDb = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertRunBinding(context, bindingDb, request);
  } finally {
    bindingDb.close();
  }

  const entry = activeCompletions.get(activeKey(context, request.runId, params.completionId));
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
