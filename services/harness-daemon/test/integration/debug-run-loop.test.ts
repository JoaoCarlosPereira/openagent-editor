import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
import { startHarnessDaemon } from "../../src/index.js";
import { parseDebugSession } from "../../src/agent/debug-mode-input.js";
import {
  DEBUG_EVIDENCE_EVENT,
  DEBUG_HYPOTHESIS_EVENT,
  DEBUG_VERIFICATION_EVENT,
} from "../../src/agent/debug-run-loop.js";

function buildWorkspaceHello(workspaceRoot: string): WorkspaceTransportHello {
  return {
    type: "workspace.hello",
    workspaceId: "ws-debug-loop-109",
    workspaceRoot,
    providerProfileId: "provider-local",
    mode: "debug",
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
        clientId: "debug-run-loop-test",
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

function makeDebugSessionInputText(samplePath: string, marker: string): string {
  const debugSession = {
    hypothesis: "O marker está presente no arquivo de amostra",
    evidence: {
      turns: [
        {
          toolCalls: [
            {
              invocationId: "inv-read-debug",
              tool: "file.read",
              permissionRequestId: "perm-read-debug",
              relativePath: samplePath,
            },
            {
              invocationId: "inv-search-debug",
              tool: "file.search",
              permissionRequestId: "perm-search-debug",
              query: marker,
            },
          ],
        },
      ],
    },
    verification: {
      outcome: "confirmed",
      summary: "Marker localizado via leitura e busca.",
    },
  };

  return JSON.stringify({
    prompt: "Investigar bug com evidência",
    debugSession,
  });
}

function loadRunHypothesis(dbPath: string, runId: string): string | null {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const row = sqlite
      .prepare("SELECT hypothesis FROM run WHERE id = ?")
      .get(runId) as { hypothesis?: string | null } | undefined;
    return row?.hypothesis ?? null;
  } finally {
    sqlite.close();
  }
}

function loadRunState(dbPath: string, runId: string): string | null {
  const sqlite = new DatabaseSync(dbPath);
  try {
    const row = sqlite.prepare("SELECT state FROM run WHERE id = ?").get(runId) as
      | { state?: string }
      | undefined;
    return row?.state ?? null;
  } finally {
    sqlite.close();
  }
}

test.describe("modo Debug no daemon (AGT-04)", { concurrency: 1 }, () => {
  test("[AGT-04] run.start registra hipótese, evidência e verificação antes de concluir", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-debug-loop-ws-"));
    const samplePath = "src/sample.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(workspaceRoot, samplePath),
      "export const AGT04_DAEMON_MARKER = 'find-me';\n",
      "utf8",
    );

    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-debug-loop-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const hello = buildWorkspaceHello(workspaceRoot);
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, hello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "debug" }, {
        workspaceId: hello.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        {
          mode: "debug",
          input: { text: makeDebugSessionInputText(samplePath, "AGT04_DAEMON_MARKER") },
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

    const db = openWorkspaceDatabase({ dataRoot, workspaceId: hello.workspaceId });
    try {
      assert.equal(
        loadRunHypothesis(db.databasePath, runId),
        "O marker está presente no arquivo de amostra",
      );
      assert.equal(loadRunState(db.databasePath, runId), "completed");

      const events = db.listHarnessEvents(runId);
      const types = events.map((event) => event.type);
      const hypothesisIndex = types.indexOf(DEBUG_HYPOTHESIS_EVENT);
      const evidenceIndex = types.indexOf(DEBUG_EVIDENCE_EVENT);
      const verificationIndex = types.indexOf(DEBUG_VERIFICATION_EVENT);
      assert.ok(hypothesisIndex >= 0);
      assert.ok(evidenceIndex > hypothesisIndex);
      assert.ok(verificationIndex > evidenceIndex);
      assert.equal(types.filter((type) => type === "tool.result").length, 2);

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

  test("[AGT-04] debugSession inválido ou ausente retorna INVALID_STATE", async () => {
    assert.throws(
      () =>
        parseDebugSession({
          hypothesis: "",
          evidence: { turns: [] },
          verification: { outcome: "confirmed", summary: "x" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-debug-loop-err-"));
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-debug-loop-err-db-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const hello = buildWorkspaceHello(workspaceRoot);
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, hello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "debug" }, {
        workspaceId: hello.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      await assert.rejects(
        () =>
          callDaemonRpc(
            socket,
            RPC_METHOD.RUN_START,
            {
              mode: "debug",
              input: { text: "mensagem sem debugSession" },
            },
            {
              workspaceId: hello.workspaceId,
              sessionId: created.sessionId,
              runId,
            },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          assert.match(error.message, /debugSession/);
          return true;
        },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
