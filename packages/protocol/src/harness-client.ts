import type net from "node:net";
import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "./harness-event.js";
import { validateHarnessEvent } from "./harness-event.js";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "./errors.js";
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
  invokeTool?(runId: string, input: RpcParamsMap[typeof RPC_METHOD.TOOL_INVOKE]): Promise<RpcResultMap[typeof RPC_METHOD.TOOL_INVOKE]>;
  decide(requestId: string, decision: GrantDecision): Promise<void>;
  cancel(runId: string, agentId?: string): Promise<void>;
  restore(checkpointId: string): Promise<RestoreResult>;
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

interface RpcStreamEndFrame {
  type: "rpc.stream.end";
  requestId: string;
}

interface HarnessEventFrame {
  type: "harness.event";
  event: HarnessEvent;
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

function throwProtocolErrorFromFrame(frame: ProtocolTransportErrorFrame): never {
  throw new ProtocolError(frame.code, frame.message, [frame.message]);
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

class TransportHarnessClient implements HarnessClient {
  public readonly binding: HarnessWorkspaceBinding;
  private readonly socket: net.Socket;
  private activeSessionId: string;
  private activeRunId: string;
  private expectedVersion = 0;
  private closed = false;

  constructor(socket: net.Socket, ack: WorkspaceTransportAck) {
    this.socket = socket;
    this.binding = bindingFromAck(ack);
    this.activeSessionId = ack.sessionIds[0] ?? `ses-${randomUUID()}`;
    this.activeRunId = `run-${randomUUID()}`;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.socket.destroy();
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
    this.activeSessionId = input.sessionId;
    this.activeRunId = input.runId;
    const requestId = randomUUID();
    await this.sendRpcEnvelope(
      RPC_METHOD.RUN_START,
      { mode: input.mode, input: input.input },
      {
        requestId,
        sessionId: input.sessionId,
        runId: input.runId,
        expectedVersion: input.expectedVersion ?? this.expectedVersion,
      },
    );

    while (!this.closed) {
      const frame = await readWireFrame(this.socket);
      if (frame.type === "protocol.error") {
        throwProtocolErrorFromFrame(frame);
      }
      // Daemon atual: run.start responde com rpc.ok cujo result é o HarnessEvent (CLI-02).
      if (frame.type === "rpc.ok" && frame.requestId === requestId) {
        const validation = validateHarnessEvent(frame.result);
        if (!validation.valid) {
          throw new ProtocolError(
            validation.code,
            validation.errors.join(" "),
            validation.errors,
          );
        }
        this.activeRunId = input.runId;
        this.activeSessionId = input.sessionId;
        yield validation.value;
        return;
      }
      if (frame.type === "harness.event") {
        const validation = validateHarnessEvent(frame.event);
        if (!validation.valid) {
          throw new ProtocolError(
            validation.code,
            validation.errors.join(" "),
            validation.errors,
          );
        }
        yield validation.value;
        continue;
      }
      if (frame.type === "rpc.stream.end" && frame.requestId === requestId) {
        return;
      }
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Frame inesperado durante run.start: ${String((frame as { type?: string }).type)}`,
      );
    }
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

  async invokeTool(runId: string, input: RpcParamsMap[typeof RPC_METHOD.TOOL_INVOKE]): Promise<RpcResultMap[typeof RPC_METHOD.TOOL_INVOKE]> {
    const result = await this.callRpc(RPC_METHOD.TOOL_INVOKE, input, { runId });
    this.activeRunId = runId;
    return result;
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
    await this.sendRpcEnvelope(method, params, {
      requestId,
      sessionId: context.sessionId ?? this.activeSessionId,
      runId: context.runId ?? this.activeRunId,
      expectedVersion: context.expectedVersion ?? this.expectedVersion,
    });

    const frame = await readWireFrame(this.socket);
    if (frame.type === "protocol.error") {
      throwProtocolErrorFromFrame(frame);
    }
    if (frame.type !== "rpc.ok" || frame.requestId !== requestId) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Resposta RPC não corresponde ao requestId enviado.",
      );
    }
    return frame.result as RpcResultMap[M];
  }

  private async sendRpcEnvelope<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context: {
      requestId: string;
      sessionId: string;
      runId: string;
      expectedVersion: number;
    },
  ): Promise<void> {
    if (this.closed) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Cliente já foi fechado.",
      );
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

