import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
import {
  listStoredSessionsByWorkspace,
  openWorkspaceDatabase,
} from "@openagent/storage";
import { DatabaseSync } from "node:sqlite";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-session-rpc-43",
  workspaceRoot: "/tmp/openagent-ws-43",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: ["mem0-local"],
  sessionIds: [],
};

type RpcClient = {
  socket: net.Socket;
  call<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context?: { sessionId?: string; runId?: string },
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
        clientId: "session-rpc-test",
      }),
      "utf8",
    ),
  );
  const versionFrame = await readProtocolFrame(socket);
  const versionResponse = JSON.parse(versionFrame.toString("utf8")) as {
    type?: string;
    protocolVersion?: number;
  };
  assert.equal(versionResponse.type, "protocol.version.ack");
  assert.equal(versionResponse.protocolVersion, OPENAGENT_DAEMON_PROTOCOL_VERSION);

  writeProtocolFrame(socket, Buffer.from(JSON.stringify(WORKSPACE), "utf8"));
  const ackFrame = await readProtocolFrame(socket);
  const ackValidation = validateWorkspaceTransportAck(
    JSON.parse(ackFrame.toString("utf8")) as unknown,
  );
  assert.equal(ackValidation.valid, true);

  const activeSessionId = `ses-${randomUUID()}`;
  const activeRunId = `run-${randomUUID()}`;

  return {
    socket,
    async call(method, params, context = {}) {
      const spec = getRpcMethodSpec(method);
      const requestId = randomUUID();
      const envelope = {
        method,
        requestId,
        workspaceId: WORKSPACE.workspaceId,
        sessionId: context.sessionId ?? activeSessionId,
        runId: context.runId ?? activeRunId,
        expectedVersion: 0,
        capability: spec.capability,
        payload: params,
        rpcVersion: RPC_PROTOCOL_VERSION,
      };
      const validation = validateRpcRequest(envelope);
      if (!validation.valid) {
        throw new ProtocolError(validation.code, validation.errors.join(" "));
      }
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

test.describe("harness-daemon session RPC", { concurrency: 1 }, () => {
  test("[SES-01] session.create e session.list persistem sessões do workspace", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-43-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      const created = await client.call(RPC_METHOD.SESSION_CREATE, { mode: "plan" });
      assert.equal(created.workspaceId, WORKSPACE.workspaceId);
      assert.equal(created.mode, "plan");

      const listed = await client.call(RPC_METHOD.SESSION_LIST, {});
      assert.ok(listed.sessions.some((entry) => entry.sessionId === created.sessionId));

      const reopened = openWorkspaceDatabase({
        dataRoot,
        workspaceId: WORKSPACE.workspaceId,
      });
      try {
        const sqlite = new DatabaseSync(reopened.databasePath);
        const stored = listStoredSessionsByWorkspace(sqlite, WORKSPACE.workspaceId);
        sqlite.close();
        assert.ok(stored.some((row) => row.id === created.sessionId));
      } finally {
        reopened.close();
      }
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-02] session.export grava arquivo de texto com mensagens", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-export-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      const created = await client.call(RPC_METHOD.SESSION_CREATE, { mode: "agent" });
      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const blob = db.putCasBlob(Buffer.from(JSON.stringify({ text: "linha exportada" }), "utf8"));
      db.insertMessage({
        id: "msg-export",
        sessionId: created.sessionId,
        role: "user",
        status: "complete",
        contentRef: blob.contentRef,
        tokenCount: 3,
      });
      db.close();

      const exported = await client.call(
        RPC_METHOD.SESSION_EXPORT,
        { format: "text" },
        { sessionId: created.sessionId },
      );
      const text = readFileSync(exported.exportRef, "utf8");
      assert.match(text, /linha exportada/);
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-05] session.search encontra sessão com mensagens que contêm o texto", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-search-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      const created = await client.call(RPC_METHOD.SESSION_CREATE, { mode: "agent" });
      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const sqliteRun = new DatabaseSync(db.databasePath);
      sqliteRun
        .prepare(`INSERT INTO run(id, session_id, state) VALUES (?, ?, ?)`)
        .run("run-search-rpc", created.sessionId, "idle");
      sqliteRun.close();
      const blob = db.putCasBlob(
        Buffer.from(JSON.stringify({ text: "refatoração do daemon RPC" }), "utf8"),
      );
      db.insertMessage({
        id: "msg-search",
        sessionId: created.sessionId,
        role: "user",
        status: "complete",
        contentRef: blob.contentRef,
        tokenCount: 5,
      });
      db.close();

      const search = await client.call(
        RPC_METHOD.SESSION_SEARCH,
        { query: "refatoração" },
        { sessionId: created.sessionId },
      );
      assert.ok(search.sessions.some((entry) => entry.sessionId === created.sessionId));

      const verifyDb = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const hits = verifyDb.searchSessionMessages({
        sessionId: created.sessionId,
        query: "refatoração",
      });
      verifyDb.close();
      assert.equal(hits.hits.length, 1);
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-06] session.fork conserva mensagens da conversa principal", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-fork-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      const parent = await client.call(RPC_METHOD.SESSION_CREATE, { mode: "agent" });
      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      db.putSessionResume({
        sessionId: parent.sessionId,
        mode: "agent",
        messagesJson: JSON.stringify([{ role: "user", text: "mensagem principal" }]),
        toolsJson: "[]",
        attachmentsJson: "[]",
      });
      db.close();

      const forked = await client.call(
        RPC_METHOD.SESSION_FORK,
        { branchId: "sess-lateral-rpc" },
        { sessionId: parent.sessionId },
      );
      assert.equal(forked.parentSessionId, parent.sessionId);

      const verifyDb = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const parentResume = verifyDb
        .listSessionResumes()
        .find((row) => row.sessionId === parent.sessionId);
      const forkResume = verifyDb
        .listSessionResumes()
        .find((row) => row.sessionId === forked.sessionId);
      verifyDb.close();
      assert.equal(parentResume?.messagesJson, forkResume?.messagesJson);
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-07] session.delete remove mensagens locais da sessão", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-delete-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      const created = await client.call(RPC_METHOD.SESSION_CREATE, { mode: "agent" });
      const deleted = await client.call(
        RPC_METHOD.SESSION_DELETE,
        {},
        { sessionId: created.sessionId },
      );
      assert.equal(deleted.deleted, true);

      const verifyDb = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const sqlite = new DatabaseSync(verifyDb.databasePath);
      const remaining = listStoredSessionsByWorkspace(sqlite, WORKSPACE.workspaceId);
      sqlite.close();
      verifyDb.close();
      assert.equal(remaining.length, 0);
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-01] session.delete com sessão inexistente retorna INVALID_STATE", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-srpc-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const client = await connectRpcClient(runtime.address);
    try {
      await assert.rejects(
        () =>
          client.call(
            RPC_METHOD.SESSION_DELETE,
            {},
            { sessionId: "sess-inexistente-rpc" },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
