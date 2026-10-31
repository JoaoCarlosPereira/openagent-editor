import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
import {
  buildCheckpointPatchFromFileChanges,
  sha256HexUtf8,
} from "@openagent/tools";
import { startHarnessDaemon } from "../../src/index.js";

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
        clientId: "checkpoint-restore-rpc-test",
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

test.describe("checkpoint.restore RPC", { concurrency: 1 }, () => {
  test("[ERR-01] restore com edição manual retorna conflito e não grava por cima", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-ckpt-restore-rpc-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-ckpt-ws-"));
    const workspaceId = "ws-checkpoint-restore-rpc";
    const relativePath = "src/feature.ts";
    const baseContent = "export const v = 1;\n";
    const resultContent = "export const v = 2;\n";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, relativePath), resultContent, "utf8");

    const baseHashes = { [relativePath]: sha256HexUtf8(baseContent) };
    const resultHashes = { [relativePath]: sha256HexUtf8(resultContent) };
    const patchText = buildCheckpointPatchFromFileChanges([
      { relativePath, baseContent, resultContent },
    ]);

    const workspaceHello: WorkspaceTransportHello = {
      type: "workspace.hello",
      workspaceId,
      workspaceRoot,
      providerProfileId: "provider-local",
      mode: "agent",
      rulesRef: "rules:default",
      mcpServerIds: [],
      sessionIds: [],
    };

    const runId = `run-${randomUUID()}`;
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, workspaceHello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-ph-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "editar" } },
        { workspaceId, sessionId: created.sessionId, runId },
      );

      const checkpoint = await callDaemonRpc(
        socket,
        RPC_METHOD.CHECKPOINT_CREATE,
        { label: "antes-restore", baseHashes, resultHashes, patchText },
        { workspaceId, sessionId: created.sessionId, runId },
      );

      await writeFile(path.join(workspaceRoot, relativePath), "export const v = 99;\n", "utf8");

      const restore = await callDaemonRpc(
        socket,
        RPC_METHOD.CHECKPOINT_RESTORE,
        { checkpointId: checkpoint.checkpointId },
        { workspaceId, sessionId: created.sessionId, runId },
      );

      if (!("conflicts" in restore)) {
        assert.fail("esperado conflito no RPC restore");
      }
      assert.equal(restore.conflicts.length, 1);
      assert.equal(restore.conflicts[0]?.currentContent, "export const v = 99;\n");
      assert.equal(restore.conflicts[0]?.proposedContent, baseContent);
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
