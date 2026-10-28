import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
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
  workspaceId: "ws-session-rpc-43",
  workspaceRoot: "/tmp/openagent-session-rpc",
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
        clientId: "session-rpc-test",
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
    runId?: string;
  },
): Promise<RpcResultMap[M]> {
  const requestId = randomUUID();
  const spec = getRpcMethodSpec(method);
  const envelope = {
    method,
    requestId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    runId: context.runId ?? `run-${randomUUID()}`,
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

function seedMessage(
  dataRoot: string,
  workspaceId: string,
  sessionId: string,
  messageId: string,
  text: string,
): void {
  const db = openWorkspaceDatabase({ dataRoot, workspaceId });
  const put = db.putCasBlob(Buffer.from(JSON.stringify({ text }), "utf8"));
  db.insertMessage({
    id: messageId,
    sessionId,
    role: "user",
    status: "complete",
    contentRef: put.contentRef,
    tokenCount: text.length,
  });
  db.close();
}

test.describe("session RPC ligado ao storage", { concurrency: 1 }, () => {
  test("[SES-01] create/list/search/export/fork/delete via daemon RPC", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-session-rpc-43-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "plan" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
      });
      assert.equal(created.workspaceId, WORKSPACE_HELLO.workspaceId);
      assert.equal(created.mode, "plan");
      assert.match(created.sessionId, /^ses-/);

      seedMessage(
        dataRoot,
        WORKSPACE_HELLO.workspaceId,
        created.sessionId,
        "msg-export",
        "linha exportável da sessão",
      );
      seedMessage(
        dataRoot,
        WORKSPACE_HELLO.workspaceId,
        created.sessionId,
        "msg-search",
        "texto único refatoração daemon",
      );

      const listed = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_LIST,
        { limit: 20 },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId },
      );
      assert.ok(listed.sessions.some((entry) => entry.sessionId === created.sessionId));

      const searched = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_SEARCH,
        { query: "refatoração" },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId },
      );
      assert.ok(searched.sessions.some((entry) => entry.sessionId === created.sessionId));

      const exported = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_EXPORT,
        { format: "text" },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId },
      );
      assert.ok(fs.existsSync(exported.exportRef));
      const exportBody = fs.readFileSync(exported.exportRef, "utf8");
      assert.match(exportBody, /refatoração daemon/);

      const forked = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_FORK,
        { branchId: "ses-fork-side" },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId },
      );
      assert.equal(forked.parentSessionId, created.sessionId);
      assert.equal(forked.sessionId, "ses-fork-side");

      const deleted = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_DELETE,
        {},
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: forked.sessionId },
      );
      assert.equal(deleted.deleted, true);

      const afterDelete = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_LIST,
        { limit: 50 },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId: created.sessionId },
      );
      assert.ok(!afterDelete.sessions.some((entry) => entry.sessionId === forked.sessionId));
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-01] workspaceId divergente retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-session-rpc-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      await assert.rejects(
        () =>
          callDaemonRpc(
            socket,
            RPC_METHOD.SESSION_CREATE,
            {},
            { workspaceId: "ws-outro", sessionId: "ses-x" },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
