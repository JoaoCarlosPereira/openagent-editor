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
import { completeRunningRunLifecycle } from "../../src/runs/run-rpc-handler.js";
import { RunStateMachine } from "../../src/state/run-state-machine.js";
import { RunMessageQueue } from "../../src/queue/run-message-queue.js";
import { createWorkspaceCustomizationRules, startHarnessDaemon } from "../../src/index.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-agent-spawn-110",
  workspaceRoot: "/tmp/openagent-agent-spawn",
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
        clientId: "agent-spawn-rpc-test",
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

test.describe("agent.spawn RPC (AGT-05)", { concurrency: 1 }, () => {
  test("[AGT-05] agent.spawn persiste subagente com nome, estado e resultado próprios", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-agent-spawn-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;
    const objective = "Pesquisar dependências do módulo X";

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let sessionId: string | undefined;
    let agentId: string | undefined;
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
        { input: { text: "início sem agentLoop" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );

      const spawned = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_SPAWN,
        { objective },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );
      agentId = spawned.agentId;
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.ok(agentId);

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const nodes = db.listAgentNodes(runId);
      assert.equal(nodes.length, 1);
      const node = nodes[0];
      assert.equal(node?.id, agentId);
      assert.equal(node?.name, objective);
      assert.equal(node?.state, "complete");
      assert.ok(node?.resultRef);
      const resultRef = node?.resultRef;
      assert.ok(resultRef);
      const restored = JSON.parse(
        Buffer.from(db.readCasBlob(resultRef)).toString("utf8"),
      ) as { summary: string; objective: string };
      assert.equal(restored.objective, objective);
      assert.match(restored.summary, /Subagente/);
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-05] run concluído recusa agent.spawn com INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-agent-spawn-err-"));
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
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    const context = {
      dataRoot,
      binding: {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        workspaceRoot: WORKSPACE_HELLO.workspaceRoot,
        providerProfileId: WORKSPACE_HELLO.providerProfileId,
        mode: WORKSPACE_HELLO.mode,
        rulesRef: WORKSPACE_HELLO.rulesRef,
        mcpServerIds: WORKSPACE_HELLO.mcpServerIds,
        sessionIds: WORKSPACE_HELLO.sessionIds,
      },
      customizationRules: createWorkspaceCustomizationRules(),
      runMachines: new Map<string, RunStateMachine>(),
      runQueues: new Map<string, RunMessageQueue>(),
    };
    completeRunningRunLifecycle(context, runId);

    const runtime2 = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket2 = await connectLocalTransport(runtime2.address);
    try {
      await performClientHandshake(socket2, WORKSPACE_HELLO);
      assert.ok(sessionId);
      const error = await callDaemonRpcExpectError(
        socket2,
        RPC_METHOD.AGENT_SPAWN,
        { objective: "tarefa tardia" },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId,
          runId,
        },
      );
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    } finally {
      socket2.destroy();
      await runtime2.stop();
    }

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      assert.equal(db.listAgentNodes(runId).length, 0);
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
