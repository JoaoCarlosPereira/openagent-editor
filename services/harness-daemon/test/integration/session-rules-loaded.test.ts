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
import { SESSION_RULES_LOADED_EVENT_TYPE } from "@openagent/policy";
import { listStoredSessionsByWorkspace, openWorkspaceDatabase } from "@openagent/storage";
import { DatabaseSync } from "node:sqlite";
import { startHarnessDaemon } from "../../src/index.js";

function writeRuleFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
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
        clientId: "session-rules-loaded-test",
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

test.describe("session.create emite regras carregadas com origem", { concurrency: 1 }, () => {
  test("[CUS-01] session.create retorna rulesLoaded com origem de usuário e projeto", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-rules-loaded-81-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ws-81-"));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "oa-home-81-"));
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    writeRuleFile(path.join(fakeHome, ".cursor", "rules", "global.mdc"), "Regra global.");
    writeRuleFile(path.join(workspaceRoot, ".cursor", "rules", "team.mdc"), "Regra do projeto.");

    const workspaceHello: WorkspaceTransportHello = {
      type: "workspace.hello",
      workspaceId: "ws-rules-loaded-81",
      workspaceRoot,
      providerProfileId: "provider-local",
      mode: "agent",
      rulesRef: "rules:project/default",
      mcpServerIds: [],
      sessionIds: [],
    };

    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, workspaceHello);

      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: workspaceHello.workspaceId,
        sessionId: `ses-placeholder-${randomUUID()}`,
        runId: `run-placeholder-${randomUUID()}`,
      });

      assert.equal(created.rulesLoaded.type, SESSION_RULES_LOADED_EVENT_TYPE);
      assert.equal(created.rulesLoaded.sessionId, created.sessionId);
      assert.equal(created.rulesLoaded.rulesRef, workspaceHello.rulesRef);
      assert.deepEqual(created.loadedRules, created.rulesLoaded.loadedRules);
      assert.equal(created.rulesLoaded.loadedRules.length, 2);

      const origins = created.rulesLoaded.loadedRules.map((entry) => entry.origin).sort();
      assert.deepEqual(origins, [
        ".cursor/rules/team.mdc",
        "~/.cursor/rules/global.mdc",
      ]);
    } finally {
      socket.destroy();
      await runtime.stop();
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }

    const reopened = openWorkspaceDatabase({
      dataRoot,
      workspaceId: workspaceHello.workspaceId,
    });
    try {
      const sqlite = new DatabaseSync(reopened.databasePath);
      const stored = listStoredSessionsByWorkspace(sqlite, workspaceHello.workspaceId);
      sqlite.close();
      assert.equal(stored.length, 1);
    } finally {
      reopened.close();
      await rm(dataRoot, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test("[CUS-01] rulesRef inválido retorna INVALID_STATE sem persistir sessão", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-rules-loaded-err-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ws-err-81-"));

    const workspaceHello: WorkspaceTransportHello = {
      type: "workspace.hello",
      workspaceId: "ws-rules-loaded-err-81",
      workspaceRoot,
      providerProfileId: "provider-local",
      mode: "agent",
      rulesRef: "invalid-ref",
      mcpServerIds: [],
      sessionIds: [],
    };

    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, workspaceHello);

      await assert.rejects(
        () =>
          callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
            workspaceId: workspaceHello.workspaceId,
            sessionId: `ses-placeholder-${randomUUID()}`,
            runId: `run-placeholder-${randomUUID()}`,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    const reopened = openWorkspaceDatabase({
      dataRoot,
      workspaceId: workspaceHello.workspaceId,
    });
    try {
      const sqlite = new DatabaseSync(reopened.databasePath);
      const stored = listStoredSessionsByWorkspace(sqlite, workspaceHello.workspaceId);
      sqlite.close();
      assert.equal(stored.length, 0);
    } finally {
      reopened.close();
      await rm(dataRoot, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[CUS-01] HarnessClient expõe loadedRules e rulesLoaded após createSession", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-rules-hclient-81-"));
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ws-hc-81-"));
    writeRuleFile(path.join(workspaceRoot, ".cursor", "rules", "only.mdc"), "Só projeto.");

    const workspaceHello: WorkspaceTransportHello = {
      type: "workspace.hello",
      workspaceId: "ws-rules-hclient-81",
      workspaceRoot,
      providerProfileId: "provider-local",
      mode: "plan",
      rulesRef: "rules:project/default",
      mcpServerIds: [],
      sessionIds: [],
    };

    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const client = await connectHarnessClient({
      address: runtime.address,
      workspaceHello,
      clientId: "cus-01-rules-loaded",
    });

    try {
      const session = await client.createSession({ mode: "plan" });
      assert.equal(session.rulesLoaded.type, SESSION_RULES_LOADED_EVENT_TYPE);
      assert.equal(session.loadedRules.length, 1);
      assert.equal(session.loadedRules[0]?.origin, ".cursor/rules/only.mdc");
    } finally {
      client.close();
      await runtime.stop();
      await rm(dataRoot, { recursive: true, force: true });
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
