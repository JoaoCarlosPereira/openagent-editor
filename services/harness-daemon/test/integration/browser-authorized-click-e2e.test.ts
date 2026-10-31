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
  workspaceId: "ws-browser-click-e2e",
  workspaceRoot: "/tmp/openagent-browser-click-e2e",
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
        clientId: "browser-click-e2e-test",
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

/** Servidor que conta cliques reais recebidos via fetch disparado pelo onclick do botão. */
function startClickableHttpServer(): Promise<{ url: string; server: Server; clickCount: () => number }> {
  let clicks = 0;
  const server = createServer((request, response) => {
    if (request.url === "/clicked") {
      clicks++;
      response.statusCode = 204;
      response.end();
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      '<button id="ok" onclick="this.textContent=\'clicado\'; fetch(\'/clicked\')">original</button>',
    );
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      resolve({ url: `http://127.0.0.1:${address.port}/`, server, clickCount: () => clicks });
    });
  });
}

test.describe(
  "AUT-01 ponta a ponta: tool.invoke browser.click reutiliza o mesmo target autorizado via RPC real",
  { concurrency: 1 },
  () => {
    test("open -> click autorizados no mesmo target produzem efeito real no DOM e tool.result distinto", async () => {
      const { url, server, clickCount } = await startClickableHttpServer();
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-click-e2e-"));
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
        await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Abrir e clicar" } }, context);

        // 1) Abertura autorizada (pré-requisito para a interação, como na task_174/open).
        const openPending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
          tool: "browser.open", target: url, arguments: {},
        }, context);
        assert.ok("pending" in openPending && openPending.pending);
        await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
          permissionRequestId: openPending.permissionRequestId, decision: "allow",
        }, context);

        // 2) Interação autorizada subsequente no mesmo target: clique real, não apenas open/captura.
        const clickPending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
          tool: "browser.click", target: url, arguments: { selector: "#ok" },
        }, context);
        assert.ok("pending" in clickPending && clickPending.pending);
        assert.notEqual(clickPending.permissionRequestId, openPending.permissionRequestId);
        assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
          permissionRequestId: clickPending.permissionRequestId, decision: "allow",
        }, context), { persisted: true });

        // O clique teve efeito real no servidor: o handler /clicked foi chamado exatamente uma vez.
        assert.equal(clickCount(), 1);

        const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
        try {
          const events = db.listHarnessEvents(context.runId);
          assert.deepEqual(
            events.map((event) => event.type),
            [
              "run.started",
              "permission.requested", "permission.decided", "tool.result",
              "permission.requested", "permission.decided", "tool.result",
            ],
          );
          const toolResultEvents = events.filter((event) => event.type === "tool.result");
          assert.equal(toolResultEvents.length, 2);
          const payloads = toolResultEvents.map((event) =>
            JSON.parse(Buffer.from(db.readCasBlob(event.payloadRef)).toString("utf8")) as {
              invocation: { tool: string; resultRef: string };
            },
          );
          const [openPayload, clickPayload] = payloads;
          assert.ok(openPayload && clickPayload);
          assert.equal(openPayload.invocation.tool, "browser.open");
          assert.equal(clickPayload.invocation.tool, "browser.click");

          const clickResultBlob = JSON.parse(
            Buffer.from(db.readCasBlob(clickPayload.invocation.resultRef)).toString("utf8"),
          ) as { result: { url: string; screenshot: string; screenshotMimeType: string } };
          assert.equal(clickResultBlob.result.url, url);
          assert.equal(clickResultBlob.result.screenshotMimeType, "image/png");
          assert.equal(
            Buffer.from(clickResultBlob.result.screenshot, "base64").subarray(0, 8).toString("hex"),
            "89504e470d0a1a0a",
          );
        } finally {
          db.close();
        }

        // run.cancel ainda encerra o worker real (já com uma interação extra realizada nele).
        assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.RUN_CANCEL, {}, context), { cancelled: true });
      } finally {
        socket.destroy();
        await runtime.stop();
        await rm(dataRoot, { recursive: true, force: true });
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test("tool.invoke browser.click com target divergente da sessão aberta é rejeitado sem efeito", async () => {
      const { url, server, clickCount } = await startClickableHttpServer();
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-click-e2e-wrongtarget-"));
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
        await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Abrir e tentar clicar em outra URL" } }, context);

        const openPending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
          tool: "browser.open", target: url, arguments: {},
        }, context);
        assert.ok("pending" in openPending && openPending.pending);
        await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
          permissionRequestId: openPending.permissionRequestId, decision: "allow",
        }, context);

        // target do tool.invoke não corresponde à URL aberta e autorizada na sessão.
        await assert.rejects(
          callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
            tool: "browser.click", target: "http://127.0.0.1:1/outra-url", arguments: { selector: "#ok" },
          }, context),
          { code: "INVALID_STATE" },
        );
        assert.equal(clickCount(), 0);
      } finally {
        socket.destroy();
        await runtime.stop();
        await rm(dataRoot, { recursive: true, force: true });
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test("permission.decide deny para browser.click não executa o clique nem persiste tool.result", async () => {
      const { url, server, clickCount } = await startClickableHttpServer();
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-click-e2e-deny-"));
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
        await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Abrir e negar clique" } }, context);

        const openPending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
          tool: "browser.open", target: url, arguments: {},
        }, context);
        assert.ok("pending" in openPending && openPending.pending);
        await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
          permissionRequestId: openPending.permissionRequestId, decision: "allow",
        }, context);

        const clickPending = await callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
          tool: "browser.click", target: url, arguments: { selector: "#ok" },
        }, context);
        assert.ok("pending" in clickPending && clickPending.pending);
        assert.deepEqual(await callDaemonRpc(socket, RPC_METHOD.PERMISSION_DECIDE, {
          permissionRequestId: clickPending.permissionRequestId, decision: "deny",
        }, context), { persisted: true });

        assert.equal(clickCount(), 0);
        const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE_HELLO.workspaceId });
        try {
          const events = db.listHarnessEvents(context.runId);
          assert.deepEqual(
            events.map((event) => event.type),
            [
              "run.started",
              "permission.requested", "permission.decided", "tool.result",
              "permission.requested", "permission.decided",
            ],
          );
        } finally {
          db.close();
        }
      } finally {
        socket.destroy();
        await runtime.stop();
        await rm(dataRoot, { recursive: true, force: true });
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test("tool.invoke browser.click sem sessão de navegador aberta é rejeitado sem efeito", async () => {
      const { url, server, clickCount } = await startClickableHttpServer();
      const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-browser-click-e2e-noopen-"));
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
        await callDaemonRpc(socket, RPC_METHOD.RUN_START, { input: { text: "Clicar sem abrir" } }, context);

        await assert.rejects(
          callDaemonRpc(socket, RPC_METHOD.TOOL_INVOKE, {
            tool: "browser.click", target: url, arguments: { selector: "#ok" },
          }, context),
          { code: "INVALID_STATE" },
        );
        assert.equal(clickCount(), 0);
      } finally {
        socket.destroy();
        await runtime.stop();
        await rm(dataRoot, { recursive: true, force: true });
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  },
);
