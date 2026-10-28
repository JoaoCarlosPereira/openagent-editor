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
  connectHarnessClient,
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

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-daemon-resume-48",
  workspaceRoot: "/tmp/openagent-ws-48",
  providerProfileId: "provider-local",
  mode: "plan",
  rulesRef: "rules:default",
  mcpServerIds: ["mem0-local"],
  sessionIds: [],
};

async function readJsonFrame(socket: net.Socket): Promise<Record<string, unknown>> {
  const frame = await readProtocolFrame(socket);
  return JSON.parse(frame.toString("utf8")) as Record<string, unknown>;
}

async function callDaemonRpc<M extends RpcMethod>(
  socket: net.Socket,
  method: M,
  params: RpcParamsMap[M],
  context: { workspaceId: string; sessionId: string },
): Promise<RpcResultMap[M]> {
  const requestId = randomUUID();
  const spec = getRpcMethodSpec(method);
  const envelope = {
    method,
    requestId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    runId: `run-${randomUUID()}`,
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
  return response.result as RpcResultMap[M];
}

async function connectWithAck(
  address: string,
  workspaceHello: WorkspaceTransportHello,
): Promise<{ socket: net.Socket; sessionIds: string[] }> {
  const socket = await connectLocalTransport(address);
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "daemon-session-resume-test",
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
  return { socket, sessionIds: [...ackValidation.value.sessionIds] };
}

test.describe("retomar sessões após reinício do daemon", { concurrency: 1 }, () => {
  test("[SES-01] workspace.ack e session.list reabrem modo, mensagens, ferramentas e anexos existentes", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-resume-48-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    let sessionId = "";

    const first = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const initialClient = await connectHarnessClient({
      address: first.address,
      workspaceHello: WORKSPACE,
    });
    try {
      const created = await initialClient.createSession({ mode: "plan" });
      sessionId = created.sessionId;

      const db = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      const attachmentPut = db.putCasBlob(Buffer.from("anexo persistido", "utf8"));
      db.putSessionResume({
        sessionId,
        mode: "plan",
        messagesJson: JSON.stringify([{ role: "user", text: "retomar daemon" }]),
        toolsJson: JSON.stringify([{ name: "grep", state: "done" }]),
        attachmentsJson: JSON.stringify([
          { id: "att-ok", kind: "file", contentRef: attachmentPut.contentRef },
          { id: "att-gone", kind: "file", contentRef: "sha256:missing-blob" },
          { id: "att-meta", kind: "selection" },
        ]),
      });
      db.close();
    } finally {
      initialClient.close();
      await first.stop();
    }

    const second = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const { socket, sessionIds } = await connectWithAck(second.address, {
      ...WORKSPACE,
      sessionIds: [],
    });
    try {
      assert.ok(sessionIds.includes(sessionId));

      const listed = await callDaemonRpc(
        socket,
        RPC_METHOD.SESSION_LIST,
        { limit: 20 },
        { workspaceId: WORKSPACE.workspaceId, sessionId },
      );
      const entry = listed.sessions.find((row) => row.sessionId === sessionId);
      assert.ok(entry);
      assert.equal(entry.mode, "plan");
      assert.deepEqual(JSON.parse(entry.messagesJson), [
        { role: "user", text: "retomar daemon" },
      ]);
      assert.deepEqual(JSON.parse(entry.toolsJson), [{ name: "grep", state: "done" }]);
      const attachments = JSON.parse(entry.attachmentsJson) as Array<{
        id: string;
        kind: string;
        contentRef?: string;
      }>;
      assert.equal(attachments.length, 2);
      const keptBlob = attachments.find((row) => row.id === "att-ok");
      assert.ok(keptBlob?.contentRef?.startsWith("sha256:"));
      const verifyDb = openWorkspaceDatabase({ dataRoot, workspaceId: WORKSPACE.workspaceId });
      try {
        const bytes = verifyDb.readCasBlob(keptBlob?.contentRef ?? "");
        assert.equal(Buffer.from(bytes).toString("utf8"), "anexo persistido");
      } finally {
        verifyDb.close();
      }
      assert.ok(attachments.some((row) => row.id === "att-meta" && row.kind === "selection"));
      assert.ok(!attachments.some((row) => row.id === "att-gone"));
    } finally {
      socket.destroy();
      await second.stop();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[SES-01] session.list com workspaceId divergente retorna INVALID_STATE", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-resume-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const { socket } = await connectWithAck(runtime.address, WORKSPACE);
    try {
      await assert.rejects(
        () =>
          callDaemonRpc(
            socket,
            RPC_METHOD.SESSION_LIST,
            { limit: 10 },
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
