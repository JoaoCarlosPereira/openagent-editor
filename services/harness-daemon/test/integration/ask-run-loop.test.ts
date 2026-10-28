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
import { AGENT_MODE_ASK_BLOCKED_MESSAGE } from "@openagent/policy";
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";
import { parseAskLoopPlan } from "../../src/agent/ask-loop-plan.js";

function buildWorkspaceHello(workspaceRoot: string): WorkspaceTransportHello {
  return {
    type: "workspace.hello",
    workspaceId: "ws-ask-loop-106",
    workspaceRoot,
    providerProfileId: "provider-local",
    mode: "ask",
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
        clientId: "ask-run-loop-test",
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
  if (!validation.valid) {
    throw new Error("Requisição RPC inválida para teste.");
  }
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

function makeAskLoopInputText(samplePath: string, searchQuery: string): string {
  const plan = {
    turns: [
      {
        toolCalls: [
          {
            invocationId: "inv-read-ask",
            tool: "file.read",
            permissionRequestId: "perm-read-ask",
            relativePath: samplePath,
          },
          {
            invocationId: "inv-search-ask",
            tool: "file.search",
            permissionRequestId: "perm-search-ask",
            query: searchQuery,
          },
        ],
      },
    ],
  };

  return JSON.stringify({
    prompt: "Explorar código sem alterar nada",
    askLoop: plan,
  });
}

test.describe("modo Ask no daemon (AGT-01)", { concurrency: 1 }, () => {
  test("[AGT-01] run.start com askLoop lê e busca sem gravar arquivo nem executar comando", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-ask-loop-ws-"));
    const samplePath = "src/sample.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    const originalContent = "export const AGT01_DAEMON_MARKER = 'find-me';\n";
    writeFileSync(path.join(workspaceRoot, samplePath), originalContent, "utf8");
    writeFileSync(path.join(workspaceRoot, "mutate-me.txt"), "unchanged\n", "utf8");

    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-ask-loop-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const hello = buildWorkspaceHello(workspaceRoot);
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, hello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "ask" }, {
        workspaceId: hello.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        {
          mode: "ask",
          input: { text: makeAskLoopInputText(samplePath, "AGT01_DAEMON_MARKER") },
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

    assert.equal(readFileSync(path.join(workspaceRoot, samplePath), "utf8"), originalContent);
    assert.equal(readFileSync(path.join(workspaceRoot, "mutate-me.txt"), "utf8"), "unchanged\n");

    const db = openWorkspaceDatabase({ dataRoot, workspaceId: hello.workspaceId });
    try {
      const events = db.listHarnessEvents(runId);
      const types = events.map((event) => event.type);
      assert.ok(types.includes("run.started"));
      assert.equal(types.filter((type) => type === "tool.result").length, 2);
      assert.ok(!types.includes("diff.grouped"));

      const streamCheck = validateHarnessEventStream(events);
      assert.equal(streamCheck.valid, true);

      const tools = db.listToolInvocations(runId);
      assert.deepEqual(
        tools.map((tool) => tool.capability).sort(),
        ["file.read", "file.search"],
      );
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-01] askLoop rejeita ferramentas mutáveis e entrada inválida retorna INVALID_STATE", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-ask-loop-err-"));
    writeFileSync(path.join(workspaceRoot, "keep.txt"), "stable\n", "utf8");

    assert.throws(
      () =>
        parseAskLoopPlan({
          turns: [
            {
              toolCalls: [
                {
                  invocationId: "inv-shell",
                  tool: "shell.exec",
                  permissionRequestId: "perm-shell",
                  command: "echo blocked",
                },
              ],
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.match(error.message, /somente leitura e busca/);
        return true;
      },
    );

    assert.throws(
      () =>
        parseAskLoopPlan({
          turns: [{ toolCalls: [{ tool: "file.read", relativePath: "" }] }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(AGENT_MODE_ASK_BLOCKED_MESSAGE, "Bloqueado pelo modo Ask.");
    assert.equal(readFileSync(path.join(workspaceRoot, "keep.txt"), "utf8"), "stable\n");
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
