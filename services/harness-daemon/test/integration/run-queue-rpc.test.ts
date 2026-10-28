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
  writeProtocolFrame,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { RunStateMachine } from "../../src/state/run-state-machine.js";
import { RunMessageQueue } from "../../src/queue/run-message-queue.js";
import { completeRunningRunLifecycle } from "../../src/runs/run-rpc-handler.js";
import { createWorkspaceCustomizationRules, startHarnessDaemon } from "../../src/index.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-run-queue-46",
  workspaceRoot: "/tmp/openagent-run-queue",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: [],
  sessionIds: [],
};

type RpcClient = {
  socket: net.Socket;
  call<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context: { sessionId: string; runId: string },
  ): Promise<RpcResultMap[M]>;
  close(): void;
};

async function connectRpcClient(address: string): Promise<RpcClient> {
  const socket = await connectLocalTransport(address);
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "run-queue-rpc-test",
      }),
      "utf8",
    ),
  );
  const versionFrame = await readProtocolFrame(socket);
  const versionResponse = JSON.parse(versionFrame.toString("utf8")) as { type?: string };
  assert.equal(versionResponse.type, "protocol.version.ack");

  writeProtocolFrame(socket, Buffer.from(JSON.stringify(WORKSPACE), "utf8"));
  const ackFrame = await readProtocolFrame(socket);
  const ackValidation = validateWorkspaceTransportAck(
    JSON.parse(ackFrame.toString("utf8")) as unknown,
  );
  assert.equal(ackValidation.valid, true);

  return {
    socket,
    async call(method, params, context) {
      const spec = getRpcMethodSpec(method);
      const requestId = randomUUID();
      const envelope = {
        method,
        requestId,
        workspaceId: WORKSPACE.workspaceId,
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
      const responseFrame = await readProtocolFrame(socket);
      const response = JSON.parse(responseFrame.toString("utf8")) as {
        type?: string;
        code?: string;
        message?: string;
        requestId?: string;
        result?: RpcResultMap[RpcMethod];
      };
      if (response.type === "protocol.error") {
        throw new ProtocolError(
          (response.code as typeof PROTOCOL_ERROR_CODES.INVALID_STATE) ??
            PROTOCOL_ERROR_CODES.INVALID_STATE,
          response.message ?? "Erro RPC",
        );
      }
      assert.equal(response.type, "rpc.ok");
      assert.equal(response.requestId, requestId);
      return response.result as RpcResultMap[typeof method];
    },
    close() {
      socket.destroy();
    },
  };
}

test.describe("run.queue.add/remove persistido", { concurrency: 1 }, () => {
  test("[AGT-06] fila ordenada, remoção só pending, persistência e consumo ao fim do run", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-run-queue-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    let daemon = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    let sessionId: string | undefined;
    try {
      const client = await connectRpcClient(daemon.address);
      const created = await client.call(
        RPC_METHOD.SESSION_CREATE,
        { mode: "agent" },
        { sessionId: "placeholder", runId },
      );
      sessionId = created.sessionId;
      await client.call(
        RPC_METHOD.RUN_START,
        { input: { text: "início" } },
        { sessionId, runId },
      );

      const first = await client.call(
        RPC_METHOD.RUN_QUEUE_ADD,
        { input: { text: "primeira" } },
        { sessionId, runId },
      );
      const second = await client.call(
        RPC_METHOD.RUN_QUEUE_ADD,
        { input: { text: "segunda" } },
        { sessionId, runId },
      );
      assert.equal(first.ordinal, 1);
      assert.equal(second.ordinal, 2);

      await client.call(
        RPC_METHOD.RUN_QUEUE_REMOVE,
        { queueItemId: second.queueItemId },
        { sessionId, runId },
      );
      client.close();
    } finally {
      await daemon.stop();
    }

    daemon = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    try {
      assert.ok(sessionId, "sessionId deve existir após run.start inicial");
      const client = await connectRpcClient(daemon.address);
      const third = await client.call(
        RPC_METHOD.RUN_QUEUE_ADD,
        { input: { text: "terceira após restart" } },
        { sessionId, runId },
      );
      assert.equal(third.ordinal, 2);
      client.close();

      const dbBefore = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const pendingBefore = dbBefore
        .listQueueItems(runId)
        .filter((item) => item.state === "pending");
      dbBefore.close();
      assert.equal(pendingBefore.length, 2);

      const context = {
        dataRoot,
        binding: {
          workspaceId: WORKSPACE.workspaceId,
          workspaceRoot: WORKSPACE.workspaceRoot,
          providerProfileId: WORKSPACE.providerProfileId,
          mode: WORKSPACE.mode,
          rulesRef: WORKSPACE.rulesRef,
          mcpServerIds: WORKSPACE.mcpServerIds,
          sessionIds: WORKSPACE.sessionIds,
        },
        customizationRules: createWorkspaceCustomizationRules(),
        runMachines: new Map<string, RunStateMachine>(),
        runQueues: new Map<string, RunMessageQueue>(),
      };
      const consumed = completeRunningRunLifecycle(context, runId);
      assert.equal(consumed.length, 2);
      assert.deepEqual(
        consumed.map((item) => item.input.text),
        ["primeira", "terceira após restart"],
      );

      const dbAfter = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const queueAfter = dbAfter.listQueueItems(runId);
      dbAfter.close();

      assert.deepEqual(
        queueAfter.map((item) => item.state),
        ["started", "started"],
      );
      assert.equal(context.runMachines.get(runId)?.snapshot().lifecycleState, "completed");
    } finally {
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-06] run.queue.add com run inexistente retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-run-queue-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    const daemon = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    try {
      const client = await connectRpcClient(daemon.address);
      const created = await client.call(
        RPC_METHOD.SESSION_CREATE,
        { mode: "agent" },
        { sessionId: "placeholder", runId },
      );
      const sessionId = created.sessionId;

      await assert.rejects(
        () =>
          client.call(
            RPC_METHOD.RUN_QUEUE_ADD,
            { input: { text: "sem run.start" } },
            { sessionId, runId },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const queue = db.listQueueItems(runId);
      db.close();
      assert.equal(queue.length, 0);
      client.close();
    } finally {
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
