import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  RPC_PROTOCOL_VERSION,
  connectLocalTransport,
  getRpcMethodSpec,
  readProtocolFrame,
  validateRpcRequest,
  validateWorkspaceTransportAck,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
  type ProtocolErrorCode,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-agent-cancel-111",
  workspaceRoot: "/tmp/openagent-agent-cancel",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: [],
  sessionIds: [],
};

async function readJsonFrame(socket: net.Socket): Promise<Record<string, unknown>> {
  const frame = await readProtocolFrame(socket);
  return JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
}

async function performClientHandshake(
  socket: net.Socket,
  workspaceHello: WorkspaceTransportHello,
): Promise<void> {
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "agent-cancel-rpc-test",
      }),
      "utf8",
    ),
  );

  const versionResponse = await readJsonFrame(socket);
  assert.equal(versionResponse.type, "protocol.version.ack");

  const workspaceValidation = validateWorkspaceTransportHello(workspaceHello);
  assert.equal(workspaceValidation.valid, true);
  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(workspaceValidation.value), "utf8"),
  );

  const workspaceResponse = await readJsonFrame(socket);
  const ackValidation = validateWorkspaceTransportAck(workspaceResponse);
  assert.equal(ackValidation.valid, true);
}

async function callDaemonRpc<M extends RpcMethod>(
  socket: net.Socket,
  method: M,
  params: RpcParamsMap[M],
  context: {
    workspaceId: string;
    sessionId: string;
    runId: string;
  },
): Promise<RpcResultMap[M]> {
  const requestId = randomUUID();
  const spec = getRpcMethodSpec(method);
  const envelope = {
    method,
    requestId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    runId: context.runId,
    expectedVersion: 0,
    capability: spec.capability,
    payload: params,
    rpcVersion: RPC_PROTOCOL_VERSION,
  };

  const validation = validateRpcRequest(envelope);
  assert.equal(validation.valid, true);
  writeProtocolFrame(socket, Buffer.from(JSON.stringify(validation.value), "utf8"));

  const response = await readJsonFrame(socket);
  if (response.type === "protocol.error") {
    throw new ProtocolError(
      (response.code as ProtocolErrorCode | undefined) ?? PROTOCOL_ERROR_CODES.INVALID_STATE,
      String(response.message ?? "protocol.error"),
    );
  }
  assert.equal(response.type, "rpc.ok");
  assert.equal(response.requestId, requestId);
  return response.result as RpcResultMap[M];
}

async function callDaemonRpcExpectError(
  socket: net.Socket,
  method: RpcMethod,
  params: RpcParamsMap[RpcMethod],
  context: {
    workspaceId: string;
    sessionId: string;
    runId: string;
  },
): Promise<ProtocolError> {
  try {
    await callDaemonRpc(socket, method, params, context);
    assert.fail("esperava protocol.error");
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    return error;
  }
}

async function waitForAgentNodeState(
  dataRoot: string,
  workspaceId: string,
  runId: string,
  agentId: string,
  expectedState: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    try {
      const node = db.listAgentNodes(runId).find((entry) => entry.id === agentId);
      if (node?.state === expectedState) {
        return;
      }
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timeout aguardando agent ${agentId} em estado ${expectedState}`);
}

test.describe("agent.cancel RPC (AGT-07)", { concurrency: 1 }, () => {
  test("[AGT-07] cancelamento isola subagente e preserva os demais", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-agent-cancel-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let sessionId: string | undefined;
    let slowAgentId: string | undefined;
    let fastAgentId: string | undefined;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });
      sessionId = created.sessionId;

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "início cancel test" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );

      const rpcContext = {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId,
        runId,
      };

      const slow = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_SPAWN,
        { objective: "[delay:3000] investigação lenta" },
        rpcContext,
      );
      slowAgentId = slow.agentId;

      const fast = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_SPAWN,
        { objective: "tarefa rápida" },
        rpcContext,
      );
      fastAgentId = fast.agentId;

      const cancelled = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_CANCEL,
        { agentId: slowAgentId },
        rpcContext,
      );
      assert.equal(cancelled.cancelled, true);
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.ok(sessionId);
    assert.ok(slowAgentId);
    assert.ok(fastAgentId);

    await waitForAgentNodeState(
      dataRoot,
      WORKSPACE_HELLO.workspaceId,
      runId,
      slowAgentId,
      "cancelled",
    );
    await waitForAgentNodeState(
      dataRoot,
      WORKSPACE_HELLO.workspaceId,
      runId,
      fastAgentId,
      "complete",
    );

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const nodes = db.listAgentNodes(runId);
      assert.equal(nodes.length, 2);
      const slowNode = nodes.find((node) => node.id === slowAgentId);
      const fastNode = nodes.find((node) => node.id === fastAgentId);
      assert.equal(slowNode?.state, "cancelled");
      assert.equal(slowNode?.resultRef, null);
      assert.equal(fastNode?.state, "complete");
      assert.ok(fastNode?.resultRef);
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-07] agentId inválido retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-agent-cancel-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let sessionId: string | undefined;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });
      sessionId = created.sessionId;

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "início" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );

      assert.ok(sessionId);
      const error = await callDaemonRpcExpectError(
        socket,
        RPC_METHOD.AGENT_CANCEL,
        { agentId: `missing-${randomUUID()}` },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
