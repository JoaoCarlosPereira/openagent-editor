import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import {
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
  type ProtocolErrorCode,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { sha256HexUtf8, snapshotWorkspaceFileForWrite } from "@openagent/tools";
import { startHarnessDaemon } from "../../src/index.js";
import { parseAgentLoopPlan } from "../../src/agent/agent-loop-plan.js";

function buildWorkspaceHello(workspaceRoot: string): WorkspaceTransportHello {
  return {
    type: "workspace.hello",
    workspaceId: "ws-agent-loop-105",
    workspaceRoot,
    providerProfileId: "provider-local",
    mode: "agent",
    rulesRef: "rules:default",
    mcpServerIds: [],
    sessionIds: [],
  };
}

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
        clientId: "agent-run-loop-test",
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

function makeAgentLoopInputText(
  workspaceRoot: string,
  fileA: string,
  fileB: string,
): string {
  const snapA = snapshotWorkspaceFileForWrite(workspaceRoot, fileA);
  const snapB = snapshotWorkspaceFileForWrite(workspaceRoot, fileB);
  const shellCommand =
    process.platform === "win32" ? "echo AGT03_LOOP_SHELL" : "echo AGT03_LOOP_SHELL";

  const plan = {
    turns: [
      {
        toolCalls: [
          {
            invocationId: "inv-write-batch",
            tool: "file.write.batch",
            permissionRequestId: "perm-write-batch",
            operations: [
              {
                relativePath: fileA,
                expectedContentHashHex: snapA.contentHashHex,
                newContent: "const a = 10;\n",
              },
              {
                relativePath: fileB,
                expectedContentHashHex: snapB.contentHashHex,
                newContent: "const b = 20;\n",
              },
            ],
          },
          {
            invocationId: "inv-shell-test",
            tool: "shell.exec",
            permissionRequestId: "perm-shell-test",
            command: shellCommand,
          },
        ],
      },
    ],
  };

  return JSON.stringify({
    prompt: "Corrigir arquivos e rodar teste autorizado",
    agentLoop: plan,
  });
}

test.describe("loop do agente no daemon (AGT-03)", { concurrency: 1 }, () => {
  test("[AGT-03] run.start com agentLoop edita múltiplos arquivos, executa shell e persiste diff agrupado", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-agent-loop-ws-"));
    const fileA = "src/a.ts";
    const fileB = "src/b.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, fileA), "const a = 1;\n", "utf8");
    writeFileSync(path.join(workspaceRoot, fileB), "const b = 1;\n", "utf8");

    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-agent-loop-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const hello = buildWorkspaceHello(workspaceRoot);
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, hello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: hello.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        {
          mode: "agent",
          input: { text: makeAgentLoopInputText(workspaceRoot, fileA, fileB) },
        },
        {
          workspaceId: hello.workspaceId,
          sessionId: created.sessionId,
          runId,
        },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.equal(readFileSync(path.join(workspaceRoot, fileA), "utf8"), "const a = 10;\n");
    assert.equal(readFileSync(path.join(workspaceRoot, fileB), "utf8"), "const b = 20;\n");
    assert.equal(sha256HexUtf8("const a = 10;\n"), sha256HexUtf8(readFileSync(path.join(workspaceRoot, fileA), "utf8")));

    const db = openWorkspaceDatabase({ dataRoot, workspaceId: hello.workspaceId });
    try {
      const events = db.listHarnessEvents(runId);
      const types = events.map((event) => event.type);
      assert.ok(types.includes("run.started"));
      assert.ok(types.filter((type) => type === "tool.result").length >= 2);
      assert.ok(types.includes("diff.grouped"));

      const streamCheck = validateHarnessEventStream(events);
      assert.equal(streamCheck.valid, true);

      const runRow = db
        .listHarnessEvents(runId)
        .length;
      assert.ok(runRow >= 4);
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-03] agentLoop inválido retorna INVALID_STATE sem efeito colateral no workspace", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-agent-loop-err-"));
    writeFileSync(path.join(workspaceRoot, "keep.txt"), "stable\n", "utf8");

    assert.throws(
      () =>
        parseAgentLoopPlan({
          turns: [{ toolCalls: [{ tool: "unknown.tool" }] }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(readFileSync(path.join(workspaceRoot, "keep.txt"), "utf8"), "stable\n");
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
