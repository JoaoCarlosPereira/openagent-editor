import type net from "node:net";
import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "./harness-event.js";
import { validateHarnessEvent } from "./harness-event.js";
import { PROTOCOL_ERROR_CODES, ProtocolError, incompleteStreamError } from "./errors.js";
import {
  validateCompletionEventPayload,
  type CompletionEventPayload,
} from "./completion-events.js";
import { OPENAGENT_DAEMON_PROTOCOL_VERSION } from "./protocol-version.js";
import {
  validateWorkspaceTransportAck,
  validateWorkspaceTransportHello,
  type WorkspaceTransportAck,
  type WorkspaceTransportHello,
  type ProtocolTransportErrorFrame,
} from "./workspace-transport.js";
import {
  connectLocalTransport,
  readProtocolFrame,
  writeProtocolFrame,
} from "./transport-local.js";
import {
  RPC_METHOD,
  RPC_PROTOCOL_VERSION,
  getRpcMethodSpec,
  type AgentMode,
  type CompletionCancelResult,
  type CompletionKind,
  type CompletionStartResult,
  type PermissionDecision,
  type CheckpointRestoreConflictEntry,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type SessionLoadedCustomizationRule,
  type SessionRulesLoadedEmission,
} from "./rpc-methods.js";
import { validateRpcRequest, type RpcRequestEnvelope } from "./rpc-validator.js";
import type { UserInput } from "./user-input.js";

/** Decisão de grant de permissão (TechSpec — HarnessClient.decide). */
export type GrantDecision = PermissionDecision;

export interface CreateSession {
  mode?: AgentMode;
}

/** Sessão ativa com facetas de workspace reutilizadas (CLI-01). */
export interface Session {
  sessionId: string;
  workspaceId: string;
  mode: AgentMode;
  providerProfileId: string;
  rulesRef: string;
  mcpServerIds: readonly string[];
  sessionIds: readonly string[];
  loadedRules: readonly SessionLoadedCustomizationRule[];
  rulesLoaded: SessionRulesLoadedEmission;
}

export interface StartRun {
  sessionId: string;
  runId: string;
  mode?: AgentMode;
  input: UserInput;
  expectedVersion?: number;
}

export interface QueueItem {
  queueItemId: string;
  ordinal: number;
  runId: string;
}

/** Pedido de completion por stream (TAB-01), vinculado a run e request. */
export interface StartCompletion {
  sessionId: string;
  runId: string;
  completionId: string;
  prefix: string;
  suffix?: string;
  language?: string;
  kind?: CompletionKind;
  requestId?: string;
  expectedVersion?: number;
}

export interface CancelCompletion {
  sessionId: string;
  runId: string;
  completionId: string;
}

/** Evento de completion já validado, com payload canônico entregue pelo daemon. */
export interface CompletionStreamEvent {
  event: HarnessEvent;
  payload: CompletionEventPayload;
}

/**
 * Stream de uma requisição `completion.start`: itera os eventos do daemon e `result`
 * resolve com o resultado terminal de `rpc.stream.end` (ou rejeita em erro/queda).
 */
export interface CompletionStream extends AsyncIterable<CompletionStreamEvent> {
  readonly requestId: string;
  readonly result: Promise<CompletionStartResult>;
}

export type RestoreResult =
  | { restored: true }
  | { conflict: true; conflicts: CheckpointRestoreConflictEntry[] };

export interface HarnessWorkspaceBinding {
  workspaceId: string;
  providerProfileId: string;
  mode: string;
  rulesRef: string;
  mcpServerIds: readonly string[];
  sessionIds: readonly string[];
}

export interface HarnessClient {
  readonly binding: HarnessWorkspaceBinding;
  callRpc<M extends RpcMethod>(method: M, params: RpcParamsMap[M]): Promise<RpcResultMap[M]>;
  createSession(input: CreateSession): Promise<Session>;
  startRun(input: StartRun): AsyncIterable<HarnessEvent>;
  enqueue(runId: string, input: UserInput): Promise<QueueItem>;
  decide(requestId: string, decision: GrantDecision): Promise<void>;
  cancel(runId: string, agentId?: string): Promise<void>;
  restore(checkpointId: string): Promise<RestoreResult>;
  startCompletion(input: StartCompletion): CompletionStream;
  cancelCompletion(input: CancelCompletion): Promise<CompletionCancelResult>;
  close(): void;
}

export interface ConnectHarnessClientOptions {
  address: string;
  workspaceHello: WorkspaceTransportHello;
  clientId?: string;
}

interface RpcOkFrame<M extends RpcMethod = RpcMethod> {
  type: "rpc.ok";
  requestId: string;
  result: RpcResultMap[M];
}

export interface RpcStreamEndFrame {
  type: "rpc.stream.end";
  requestId: string;
  result?: unknown;
}

export interface HarnessEventFrame {
  type: "harness.event";
  /** Requisição RPC à qual o evento pertence (multiplexação de streams). */
  requestId?: string;
  event: HarnessEvent;
  /** Payload canônico inline do evento (o payloadRef aponta para o mesmo conteúdo no CAS). */
  payload?: unknown;
}

type WireFrame =
  | ProtocolTransportErrorFrame
  | RpcOkFrame
  | RpcStreamEndFrame
  | HarnessEventFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingFromAck(ack: WorkspaceTransportAck): HarnessWorkspaceBinding {
  return {
    workspaceId: ack.workspaceId,
    providerProfileId: ack.providerProfileId,
    mode: ack.mode,
    rulesRef: ack.rulesRef,
    mcpServerIds: ack.mcpServerIds,
    sessionIds: ack.sessionIds,
  };
}

function sessionFromCreateResult(
  binding: HarnessWorkspaceBinding,
  result: RpcResultMap[typeof RPC_METHOD.SESSION_CREATE],
): Session {
  return {
    sessionId: result.sessionId,
    workspaceId: result.workspaceId,
    mode: result.mode,
    providerProfileId: binding.providerProfileId,
    rulesRef: binding.rulesRef,
    mcpServerIds: binding.mcpServerIds,
    sessionIds: binding.sessionIds,
    loadedRules: result.loadedRules,
    rulesLoaded: result.rulesLoaded,
  };
}

function throwProtocolErrorFromRecord(frame: Record<string, unknown>): never {
  const code =
    typeof frame["code"] === "string"
      ? (frame["code"] as ProtocolTransportErrorFrame["code"])
      : PROTOCOL_ERROR_CODES.INVALID_STATE;
  const message =
    typeof frame["message"] === "string" ? frame["message"] : "Erro de protocolo.";
  throw new ProtocolError(code, message, [message]);
}

async function readJsonFrame(socket: net.Socket): Promise<Record<string, unknown>> {
  const body = await readProtocolFrame(socket);
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  if (!isRecord(parsed) || typeof parsed["type"] !== "string") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Frame de protocolo inválido.",
      ["Resposta não é um objeto com campo type."],
    );
  }
  return parsed;
}

async function readWireFrame(socket: net.Socket): Promise<WireFrame> {
  const parsed = await readJsonFrame(socket);
  return parsed as unknown as WireFrame;
}

async function performTransportHandshake(
  socket: net.Socket,
  workspaceHello: WorkspaceTransportHello,
  clientId?: string,
): Promise<WorkspaceTransportAck> {
  const workspaceValidation = validateWorkspaceTransportHello(workspaceHello);
  if (!workspaceValidation.valid) {
    socket.destroy();
    throw new ProtocolError(
      workspaceValidation.code,
      workspaceValidation.errors.join(" "),
      workspaceValidation.errors,
    );
  }

  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        ...(clientId ? { clientId } : {}),
      }),
      "utf8",
    ),
  );

  const versionResponse = await readJsonFrame(socket);
  if (versionResponse["type"] === "protocol.error") {
    throwProtocolErrorFromRecord(versionResponse);
  }
  if (
    versionResponse["type"] !== "protocol.version.ack" ||
    versionResponse["protocolVersion"] !== OPENAGENT_DAEMON_PROTOCOL_VERSION
  ) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Handshake de versão não retornou protocol.version.ack compatível.",
    );
  }

  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(workspaceValidation.value), "utf8"),
  );

  const workspaceResponse = await readJsonFrame(socket);
  if (workspaceResponse["type"] === "protocol.error") {
    throwProtocolErrorFromRecord(workspaceResponse);
  }
  const ackValidation = validateWorkspaceTransportAck(workspaceResponse);
  if (!ackValidation.valid) {
    throw new ProtocolError(
      ackValidation.code,
      ackValidation.errors.join(" "),
      ackValidation.errors,
    );
  }

  return ackValidation.value;
}

/** Fila assíncrona de um item por vez com encerramento limpo ou com erro. */
class StreamChannel<T> {
  private readonly items: T[] = [];
  private waiters: Array<() => void> = [];
  private finished = false;
  private failure: Error | undefined;

  push(item: T): void {
    if (this.finished) {
      return;
    }
    this.items.push(item);
    this.wake();
  }

  end(): void {
    this.finished = true;
    this.wake();
  }

  fail(error: Error): void {
    if (this.finished) {
      return;
    }
    this.failure = error;
    this.finished = true;
    this.wake();
  }

  async *drain(): AsyncGenerator<T, void, void> {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.failure) {
        throw this.failure;
      }
      if (this.finished) {
        return;
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}

type PendingRequest =
  | {
      kind: "call";
      resolve: (frame: RpcOkFrame) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: "stream";
      onEvent: (frame: HarnessEventFrame) => void;
      onEnd: (frame: RpcStreamEndFrame) => void;
      onError: (error: Error) => void;
    };

class TransportHarnessClient implements HarnessClient {
  public readonly binding: HarnessWorkspaceBinding;
  private readonly socket: net.Socket;
  private activeSessionId: string;
  private activeRunId: string;
  private expectedVersion = 0;
  private closed = false;
  /** Falha terminal da conexão; novas chamadas são recusadas em vez de ficarem penduradas. */
  private connectionFailure: Error | undefined;
  /** Requisições em voo; um único leitor de frames as despacha por requestId. */
  private readonly pending = new Map<string, PendingRequest>();

  constructor(socket: net.Socket, ack: WorkspaceTransportAck) {
    this.socket = socket;
    this.binding = bindingFromAck(ack);
    this.activeSessionId = ack.sessionIds[0] ?? `ses-${randomUUID()}`;
    this.activeRunId = `run-${randomUUID()}`;
    void this.pump();
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
      this.failAll(
        new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Cliente já foi fechado."),
      );
    }
  }

  async createSession(input: CreateSession): Promise<Session> {
    const result = await this.callRpc(RPC_METHOD.SESSION_CREATE, input);
    const session = sessionFromCreateResult(this.binding, result);
    this.activeSessionId = session.sessionId;
    return session;
  }

  startRun(input: StartRun): AsyncIterable<HarnessEvent> {
    return this.iterateRunStart(input);
  }

  private async *iterateRunStart(input: StartRun): AsyncGenerator<HarnessEvent> {
    const requestId = randomUUID();
    const channel = new StreamChannel<HarnessEvent>();
    this.pending.set(requestId, {
      kind: "stream",
      onEvent: (frame) => {
        const validation = validateHarnessEvent(frame.event);
        if (!validation.valid) {
          channel.fail(
            new ProtocolError(validation.code, validation.errors.join(" "), validation.errors),
          );
          return;
        }
        channel.push(validation.value);
      },
      onEnd: () => channel.end(),
      onError: (error) => channel.fail(error),
    });
    try {
      this.sendRpcEnvelope(
        RPC_METHOD.RUN_START,
        { mode: input.mode, input: input.input },
        {
          requestId,
          sessionId: input.sessionId,
          runId: input.runId,
          expectedVersion: input.expectedVersion ?? this.expectedVersion,
        },
      );
      yield* channel.drain();
    } finally {
      this.pending.delete(requestId);
    }
  }

  startCompletion(input: StartCompletion): CompletionStream {
    const requestId = input.requestId ?? randomUUID();
    const channel = new StreamChannel<CompletionStreamEvent>();
    let resolveResult!: (value: CompletionStartResult) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<CompletionStartResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // O consumidor pode ignorar `result`; a falha continua visível ao iterar o stream.
    result.catch(() => undefined);

    const fail = (error: Error): void => {
      channel.fail(error);
      rejectResult(error);
      this.pending.delete(requestId);
    };

    this.pending.set(requestId, {
      kind: "stream",
      onEvent: (frame) => {
        const eventCheck = validateHarnessEvent(frame.event);
        if (!eventCheck.valid) {
          fail(new ProtocolError(eventCheck.code, eventCheck.errors.join(" "), eventCheck.errors));
          return;
        }
        const payloadCheck = validateCompletionEventPayload(frame.payload);
        if (!payloadCheck.valid) {
          fail(
            new ProtocolError(
              PROTOCOL_ERROR_CODES.INVALID_STATE,
              payloadCheck.errors.join(" "),
              payloadCheck.errors,
            ),
          );
          return;
        }
        if (payloadCheck.value.completionId !== input.completionId) {
          fail(
            new ProtocolError(
              PROTOCOL_ERROR_CODES.INVALID_STATE,
              "Evento de completion não pertence ao pedido.",
              [payloadCheck.value.completionId, input.completionId],
            ),
          );
          return;
        }
        channel.push({ event: eventCheck.value, payload: payloadCheck.value });
      },
      onEnd: (frame) => {
        this.pending.delete(requestId);
        channel.end();
        resolveResult(frame.result as CompletionStartResult);
      },
      onError: fail,
    });

    try {
      this.sendRpcEnvelope(
        RPC_METHOD.COMPLETION_START,
        {
          completionId: input.completionId,
          prefix: input.prefix,
          ...(input.suffix !== undefined ? { suffix: input.suffix } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
        },
        {
          requestId,
          sessionId: input.sessionId,
          runId: input.runId,
          expectedVersion: input.expectedVersion ?? this.expectedVersion,
        },
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }

    return {
      requestId,
      result,
      [Symbol.asyncIterator]: () => channel.drain(),
    };
  }

  async cancelCompletion(input: CancelCompletion): Promise<CompletionCancelResult> {
    return this.callRpc(
      RPC_METHOD.COMPLETION_CANCEL,
      { completionId: input.completionId },
      { sessionId: input.sessionId, runId: input.runId },
    );
  }

  async enqueue(runId: string, input: UserInput): Promise<QueueItem> {
    const result = await this.callRpc(
      RPC_METHOD.RUN_QUEUE_ADD,
      { input },
      { runId },
    );
    return {
      queueItemId: result.queueItemId,
      ordinal: result.ordinal,
      runId,
    };
  }

  async decide(requestId: string, decision: GrantDecision): Promise<void> {
    await this.callRpc(
      RPC_METHOD.PERMISSION_DECIDE,
      { permissionRequestId: requestId, decision },
      { requestId },
    );
  }

  async cancel(runId: string, agentId?: string): Promise<void> {
    await this.callRpc(RPC_METHOD.RUN_CANCEL, agentId ? { agentId } : {}, {
      runId,
    });
  }

  async restore(checkpointId: string): Promise<RestoreResult> {
    const result = await this.callRpc(RPC_METHOD.CHECKPOINT_RESTORE, {
      checkpointId,
    });
    if ("conflict" in result && result.conflict) {
      return { conflict: true, conflicts: result.conflicts };
    }
    return { restored: true };
  }

  async callRpc<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context: {
      requestId?: string;
      sessionId?: string;
      runId?: string;
      expectedVersion?: number;
    } = {},
  ): Promise<RpcResultMap[M]> {
    const requestId = context.requestId ?? randomUUID();
    const response = new Promise<RpcOkFrame>((resolve, reject) => {
      this.pending.set(requestId, { kind: "call", resolve, reject });
    });
    response.catch(() => undefined);
    try {
      this.sendRpcEnvelope(method, params, {
        requestId,
        sessionId: context.sessionId ?? this.activeSessionId,
        runId: context.runId ?? this.activeRunId,
        expectedVersion: context.expectedVersion ?? this.expectedVersion,
      });
    } catch (error) {
      this.pending.delete(requestId);
      throw error;
    }
    const frame = await response;
    return frame.result as RpcResultMap[M];
  }

  /** Único leitor do socket: roteia cada frame para a requisição dona pelo requestId. */
  private async pump(): Promise<void> {
    try {
      while (!this.closed) {
        const frame = await readWireFrame(this.socket);
        this.route(frame);
      }
    } catch (error) {
      if (this.closed) {
        return;
      }
      this.failConnection(
        error instanceof ProtocolError && error.code !== PROTOCOL_ERROR_CODES.INVALID_STATE
          ? error
          : incompleteStreamError(),
      );
    }
  }

  private route(frame: WireFrame): void {
    switch (frame.type) {
      case "protocol.error": {
        const error = new ProtocolError(frame.code, frame.message, [frame.message]);
        const target = frame.requestId !== undefined ? this.pending.get(frame.requestId) : undefined;
        if (frame.requestId !== undefined && target) {
          this.pending.delete(frame.requestId);
          if (target.kind === "call") {
            target.reject(error);
          } else {
            target.onError(error);
          }
          return;
        }
        // Sem requestId não há dono confiável: encerra a conexão em vez de culpar outra requisição.
        if (frame.requestId === undefined) {
          this.failConnection(error);
        }
        return;
      }
      case "rpc.ok": {
        const target = this.pending.get(frame.requestId);
        if (target?.kind === "call") {
          this.pending.delete(frame.requestId);
          target.resolve(frame);
        } else if (target?.kind === "stream") {
          // run.start responde com um único rpc.ok (o evento run.started): entrega e encerra.
          this.pending.delete(frame.requestId);
          target.onEvent({
            type: "harness.event",
            requestId: frame.requestId,
            event: frame.result as HarnessEvent,
          });
          target.onEnd({ type: "rpc.stream.end", requestId: frame.requestId });
        }
        return;
      }
      case "harness.event": {
        const target = this.resolveStreamTarget(frame.requestId);
        target?.onEvent(frame);
        return;
      }
      case "rpc.stream.end": {
        const target = this.pending.get(frame.requestId);
        if (target?.kind === "stream") {
          this.pending.delete(frame.requestId);
          target.onEnd(frame);
        }
        return;
      }
    }
  }

  private resolveStreamTarget(
    requestId: string | undefined,
  ): Extract<PendingRequest, { kind: "stream" }> | undefined {
    if (requestId !== undefined) {
      const target = this.pending.get(requestId);
      return target?.kind === "stream" ? target : undefined;
    }
    const streams = [...this.pending.values()].filter(
      (entry): entry is Extract<PendingRequest, { kind: "stream" }> => entry.kind === "stream",
    );
    return streams.length === 1 ? streams[0] : undefined;
  }

  private failConnection(error: Error): void {
    this.connectionFailure ??= error;
    this.failAll(error);
  }

  private failAll(error: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.kind === "call") {
        entry.reject(error);
      } else {
        entry.onError(error);
      }
    }
  }

  private sendRpcEnvelope<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context: {
      requestId: string;
      sessionId: string;
      runId: string;
      expectedVersion: number;
    },
  ): void {
    if (this.closed) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Cliente já foi fechado.",
      );
    }
    if (this.connectionFailure) {
      throw this.connectionFailure;
    }

    const spec = getRpcMethodSpec(method);
    const envelope: RpcRequestEnvelope<M> = {
      method,
      requestId: context.requestId,
      workspaceId: this.binding.workspaceId,
      sessionId: context.sessionId,
      runId: context.runId,
      expectedVersion: context.expectedVersion,
      capability: spec.capability,
      payload: params,
      rpcVersion: RPC_PROTOCOL_VERSION,
    };

    const validation = validateRpcRequest(envelope);
    if (!validation.valid) {
      throw new ProtocolError(
        validation.code,
        validation.errors.join(" "),
        validation.errors,
      );
    }

    writeProtocolFrame(this.socket, Buffer.from(JSON.stringify(validation.value), "utf8"));
  }
}

export async function connectHarnessClient(
  options: ConnectHarnessClientOptions,
): Promise<HarnessClient> {
  const socket = await connectLocalTransport(options.address);
  try {
    const ack = await performTransportHandshake(
      socket,
      options.workspaceHello,
      options.clientId,
    );
    return new TransportHarnessClient(socket, ack);
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export function buildHarnessRpcOkFrame(
  requestId: string,
  result: RpcResultMap[RpcMethod],
): RpcOkFrame {
  return { type: "rpc.ok", requestId, result };
}

export function buildHarnessEventFrame(
  requestId: string,
  event: HarnessEvent,
  payload: unknown,
): HarnessEventFrame {
  return { type: "harness.event", requestId, event, payload };
}

export function buildRpcStreamEndFrame(
  requestId: string,
  result?: RpcResultMap[RpcMethod],
): RpcStreamEndFrame {
  return { type: "rpc.stream.end", requestId, ...(result !== undefined ? { result } : {}) };
}

