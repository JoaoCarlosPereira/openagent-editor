import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import {
  HARNESS_EVENT_SCHEMA_VERSION,
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  RPC_PROTOCOL_VERSION,
  connectLocalTransport,
  getRpcMethodSpec,
  readProtocolFrame,
  validateHarnessEventStream,
  validateRpcRequest,
  validateWorkspaceTransportAck,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
  type RpcMethod,
  type RpcParamsMap,
  type ProtocolErrorCode,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-run-start-44",
  workspaceRoot: "/tmp/openagent-run-start",
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
        clientId: "run-start-test",
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
    capability?: string;
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
    capability: context.capability ?? spec.capability,
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

test.describe("run.start emitindo HarnessEvent persistido", { concurrency: 1 }, () => {
  test("permissão de browser por RPC fica vinculada à run e é persistida", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-permission-"));
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory: path.join(dataRoot, "runtime") });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: "placeholder", runId: "placeholder",
      });
      const context = { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId, runId: `run-${randomUUID()}` };
      await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Iniciar" } }, context);
      const pending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
        tool: "browser.open", target: "https://example.com/", arguments: {},
      }, context);
      assert.ok("pending" in pending);
      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
        permissionRequestId: pending.permissionRequestId, decision: "allow",
      }, { ...context, sessionId: "outra" }), { code: "INVALID_STATE" });
      assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
        permissionRequestId: pending.permissionRequestId, decision: "deny",
      }, context), { persisted: true });
      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
        permissionRequestId: pending.permissionRequestId, decision: "allow",
      }, context), { code: "INVALID_STATE" });
      await callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context);
      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
        tool: "browser.open", target: "https://example.com/", arguments: {},
      }, context), { code: "INVALID_STATE" });
      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        assert.deepEqual(db.listHarnessEvents(context.runId).map((event) => event.type),
          ["run.started", "permission.requested", "permission.decided"]);
      } finally { db.close(); }
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("run.cancel por RPC persiste estado e rejeita outra sessão e repetição", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-run-cancel-"));
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory: path.join(dataRoot, "runtime") });
    const socket = await connectLocalTransport(runtime.address);
    const runId = `run-${randomUUID()}`;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: "placeholder", runId: "placeholder",
      });
      const context = { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId, runId };
      await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Iniciar" } }, context);
      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, { ...context, sessionId: "outra" }),
        { code: "INVALID_STATE" });
      assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context), { cancelled: true });
      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context), { code: "INVALID_STATE" });
      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        const sqlite = new (await import("node:sqlite")).DatabaseSync(db.databasePath);
        try {
          assert.equal((sqlite.prepare("SELECT state FROM run WHERE id = ?").get(runId) as { state: string }).state,
            "cancelled");
        } finally { sqlite.close(); }
      } finally { db.close(); }
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-01] run.start persiste run.started e sobrevive a reinício do storage", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-run-start-44-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      const started = await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "Olá, daemon" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId: created.sessionId,
          runId,
        },
      );

      assert.equal(started.runId, runId);
      assert.equal(started.type, "run.started");
      assert.equal(started.schemaVersion, HARNESS_EVENT_SCHEMA_VERSION);
      assert.equal(started.sequence, 1);
      assert.ok(started.payloadRef.startsWith("sha256:"));
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    const reopened = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const events = reopened.listHarnessEvents(runId);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.type, "run.started");
      const streamCheck = validateHarnessEventStream(events);
      assert.equal(streamCheck.valid, true);
    } finally {
      reopened.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-01] run.start com sessionId inexistente retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-run-start-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const runId = `run-${randomUUID()}`;
      await assert.rejects(
        () =>
          callDaemonRpc(
            socket,
            RPC_METHOD.RUN_START,
            { input: { text: "mensagem válida" } },
            {
              workspaceId: WORKSPACE_HELLO.workspaceId,
              sessionId: "ses-inexistente",
              runId,
            },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const db = openWorkspaceDatabase({
        dataRoot,
        workspaceId: WORKSPACE_HELLO.workspaceId,
      });
      try {
        assert.equal(db.listHarnessEvents(runId).length, 0);
      } finally {
        db.close();
      }
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
