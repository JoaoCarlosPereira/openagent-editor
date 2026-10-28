import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
import { assertMayDispatchToolForLifecycle } from "../../src/state/terminal-run-tool-guard.js";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-run-cancel-47",
  workspaceRoot: "/tmp/openagent-run-cancel",
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
        clientId: "run-cancel-per02-test",
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

function readRunState(dbPath: string, runId: string): string | undefined {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const row = sqlite.prepare("SELECT state FROM run WHERE id = ?").get(runId) as
      | { state?: string }
      | undefined;
    return row?.state;
  } finally {
    sqlite.close();
  }
}

test.describe("run.cancel PER-02", { concurrency: 1 }, () => {
  test("[PER-02] cancelamento marca Cancelada em até 2 s, bloqueia ferramenta e conserva alteração", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-run-cancel-"));
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
      await client.call(
        RPC_METHOD.RUN_START,
        { input: { text: "início" } },
        { sessionId, runId },
      );

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const appliedPatch = db.putCasBlob(Buffer.from('{"applied":true}', "utf8"));
      const toolId = randomUUID();
      const toolPayload = db.putCasBlob(
        Buffer.from(
          JSON.stringify({
            runId,
            invocation: {
              id: toolId,
              tool: "write_file",
              target: "src/example.ts",
              capability: "file.write",
              state: "completed",
              resultRef: appliedPatch.contentRef,
            },
          }),
          "utf8",
        ),
      );
      db.appendHarnessEvent({
        runId,
        type: "tool.result",
        payloadRef: toolPayload.contentRef,
        timestamp: Date.now(),
      });
      db.rebuildProjectionsFromEventLog(sessionId);
      db.close();

      const startedAt = Date.now();
      const result = await client.call(RPC_METHOD.RUN_CANCEL, {}, { sessionId, runId });
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.cancelled, true);
      assert.ok(elapsedMs < 2000, `cancelamento demorou ${elapsedMs}ms`);

      const dbAfter = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const dbPath = dbAfter.databasePath;
      assert.equal(readRunState(dbPath, runId), "cancelled");

      const tools = dbAfter.listToolInvocations(runId);
      assert.equal(tools.length, 1);
      assert.equal(tools[0]?.id, toolId);
      assert.equal(tools[0]?.resultRef, appliedPatch.contentRef);
      assert.equal(
        Buffer.from(dbAfter.readCasBlob(appliedPatch.contentRef)).toString("utf8"),
        '{"applied":true}',
      );
      dbAfter.close();

      assert.throws(
        () => assertMayDispatchToolForLifecycle("cancelled"),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          assert.equal(error.hints?.runState, "cancelled");
          return true;
        },
      );

      await assert.rejects(
        () =>
          client.call(
            RPC_METHOD.RUN_QUEUE_ADD,
            { input: { text: "não deve enfileirar" } },
            { sessionId, runId },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      client.close();
    } finally {
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PER-02] run.cancel com run inexistente retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-run-cancel-invalid-"));
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
        () => client.call(RPC_METHOD.RUN_CANCEL, {}, { sessionId, runId }),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      assert.equal(readRunState(db.databasePath, runId), undefined);
      db.close();
      client.close();
    } finally {
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PER-02] run.cancel idempotente em execução já cancelada retorna INVALID_STATE", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "oa-run-cancel-twice-"));
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
      await client.call(
        RPC_METHOD.RUN_START,
        { input: { text: "início" } },
        { sessionId, runId },
      );
      await client.call(RPC_METHOD.RUN_CANCEL, {}, { sessionId, runId });

      await assert.rejects(
        () => client.call(RPC_METHOD.RUN_CANCEL, {}, { sessionId, runId }),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const machine = new RunStateMachine("cancelled");
      assert.throws(() => machine.assertMayDispatchTool());
      client.close();
    } finally {
      await daemon.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
