import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import { DatabaseSync } from "node:sqlite";
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
import {
  getStoredCheckpointById,
  openWorkspaceDatabase,
  readCheckpointPatchFromRef,
} from "@openagent/storage";
import { sha256HexUtf8 } from "@openagent/tools";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-checkpoint-rpc-69",
  workspaceRoot: "/tmp/openagent-checkpoint-rpc",
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
        clientId: "checkpoint-create-rpc-test",
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

test.describe("checkpoint.create RPC", { concurrency: 1 }, () => {
  test("[SES-03] checkpoint.create via daemon persiste hashes e patchRef do run", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-ckpt-rpc-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;
    const baseContent = "export const v = 1;\n";
    const resultContent = "export const v = 2;\n";
    const relativePath = "src/feature.ts";
    const baseHashes = { [relativePath]: sha256HexUtf8(baseContent) };
    const resultHashes = { [relativePath]: sha256HexUtf8(resultContent) };
    const patchText = `--- a/${relativePath}\n+++ b/${relativePath}\n@@\n-${baseContent}+${resultContent}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let checkpointId: string | undefined;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "editar arquivo" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId: created.sessionId,
          runId,
        },
      );

      const checkpoint = await callDaemonRpc(
        socket,
        RPC_METHOD.CHECKPOINT_CREATE,
        {
          label: "pós-agente",
          baseHashes,
          resultHashes,
          patchText,
        },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId: created.sessionId,
          runId,
        },
      );

      checkpointId = checkpoint.checkpointId;
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.ok(checkpointId);

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const sqlite = new DatabaseSync(db.databasePath);
      try {
        const casRoot = path.join(path.dirname(db.databasePath), "cas");
        const stored = getStoredCheckpointById(sqlite, checkpointId);
        assert.ok(stored);
        if (!stored) {
          return;
        }
        assert.equal(stored.runId, runId);
        assert.equal(stored.label, "pós-agente");
        assert.equal(readCheckpointPatchFromRef(sqlite, casRoot, stored.patchRef), patchText);
      } finally {
        sqlite.close();
      }
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
