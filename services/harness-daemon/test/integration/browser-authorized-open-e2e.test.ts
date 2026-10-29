import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
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
  workspaceId: "ws-browser-e2e",
  workspaceRoot: "/tmp/openagent-browser-e2e",
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
        clientId: "browser-e2e-test",
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

async function startLocalHttpServer(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<button id="ok">original</button>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

test.describe("AUT-01 ponta a ponta: tool.invoke -> permission.decide -> navegador real -> run.cancel", { concurrency: 1 }, () => {
  test("abertura autorizada dispara o worker real do navegador e persiste tool.result com screenshot", async () => {
    const { url, server } = await startLocalHttpServer();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-e2e-"));
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory: path.join(dataRoot, "runtime") });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: "placeholder", runId: "placeholder",
      });
      const context = {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: created.sessionId,
        runId: `run-${randomUUID()}`,
      };
      await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Abrir navegador" } }, context);

      const pending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
        tool: "browser.open", target: url, arguments: {},
      }, context);
      assert.ok("pending" in pending && pending.pending);

      // Autorização explícita: só a partir daqui o worker real do navegador é lançado.
      assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
        permissionRequestId: pending.permissionRequestId, decision: "allow",
      }, context), { persisted: true });

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      let resultRef: string | undefined;
      try {
        const events = db.listHarnessEvents(context.runId);
        assert.deepEqual(
          events.map((event) => event.type),
          ["run.started", "permission.requested", "permission.decided", "tool.result"],
        );
        const toolResultEvent = events.find((event) => event.type === "tool.result");
        assert.ok(toolResultEvent);
        const payload = JSON.parse(
          Buffer.from(db.readCasBlob(toolResultEvent.payloadRef)).toString("utf8"),
        ) as { invocation: { tool: string; capability: string; state: string; resultRef: string } };
        assert.equal(payload.invocation.tool, "browser.open");
        assert.equal(payload.invocation.capability, "browser.open");
        assert.equal(payload.invocation.state, "completed");
        resultRef = payload.invocation.resultRef;
      } finally {
        db.close();
      }

      const resultDb = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        assert.ok(resultRef);
        const resultBlob = JSON.parse(
          Buffer.from(resultDb.readCasBlob(resultRef)).toString("utf8"),
        ) as {
          kind: string;
          result: { url: string; screenshot: string; screenshotMimeType: string };
        };
        assert.equal(resultBlob.kind, "tool_result");
        assert.equal(resultBlob.result.url, url);
        assert.equal(resultBlob.result.screenshotMimeType, "image/png");
        assert.equal(
          Buffer.from(resultBlob.result.screenshot, "base64").subarray(0, 8).toString("hex"),
          "89504e470d0a1a0a",
        );
      } finally {
        resultDb.close();
      }

      // run.cancel deve encerrar o worker real do navegador e registrar o evento correspondente.
      assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context), { cancelled: true });
      const dbAfterCancel = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        const events = dbAfterCancel.listHarnessEvents(context.runId);
        assert.deepEqual(
          events.map((event) => event.type),
          ["run.started", "permission.requested", "permission.decided", "tool.result", "browser.cancelled"],
        );
      } finally {
        dbAfterCancel.close();
      }

      await assert.rejects(callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context), { code: "INVALID_STATE" });
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("recusa de permissão não dispara o worker do navegador nem persiste tool.result", async () => {
    const { url, server } = await startLocalHttpServer();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-e2e-deny-"));
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory: path.join(dataRoot, "runtime") });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: "placeholder", runId: "placeholder",
      });
      const context = {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: created.sessionId,
        runId: `run-${randomUUID()}`,
      };
      await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Abrir navegador" } }, context);
      const pending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
        tool: "browser.open", target: url, arguments: {},
      }, context);
      assert.ok("pending" in pending && pending.pending);
      assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
        permissionRequestId: pending.permissionRequestId, decision: "deny",
      }, context), { persisted: true });

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        const events = db.listHarnessEvents(context.runId);
        assert.deepEqual(
          events.map((event) => event.type),
          ["run.started", "permission.requested", "permission.decided"],
        );
      } finally {
        db.close();
      }

      // run.cancel não encontra sessão de navegador registrada: não emite browser.cancelled.
      await callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context);
      const dbAfterCancel = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
      try {
        const events = dbAfterCancel.listHarnessEvents(context.runId);
        assert.deepEqual(
          events.map((event) => event.type),
          ["run.started", "permission.requested", "permission.decided"],
        );
      } finally {
        dbAfterCancel.close();
      }
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
