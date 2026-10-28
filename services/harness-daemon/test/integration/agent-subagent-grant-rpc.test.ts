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
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-subagent-grant-112",
  workspaceRoot: "/tmp/openagent-subagent-grant",
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
        clientId: "agent-subagent-grant-test",
      }),
      "utf8",
    ),
  );
  await readJsonFrame(socket);

  const workspaceValidation = validateWorkspaceTransportHello(workspaceHello);
  assert.equal(workspaceValidation.valid, true);
  writeProtocolFrame(
    socket,
    Buffer.from(JSON.stringify(workspaceValidation.value), "utf8"),
  );
  await readJsonFrame(socket);
}

async function callDaemonRpc<M extends RpcMethod>(
  socket: net.Socket,
  method: M,
  params: RpcParamsMap[M],
  context: { workspaceId: string; sessionId: string; runId: string },
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
  return response.result as RpcResultMap[M];
}

async function waitForAgentNodeState(
  dataRoot: string,
  workspaceId: string,
  runId: string,
  agentId: string,
  expectedState: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    try {
      const node = db.listAgentNodes(runId).find((entry) => entry.id === agentId);
      if (node?.state === expectedState) {
        return;
      }
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout aguardando AgentNode ${agentId} em ${expectedState}`);
}

test.describe("Subagente herda grants sem ampliar (AGT-05 / PER-01)", { concurrency: 1 }, () => {
  test("[AGT-05][PER-01] grant-check herda grant do run pai e capabilities declaradas não ampliam", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-subagent-grant-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;
    const objective =
      "[run-grant-seed:session:file.write:src/inherit.ts][declared-caps:shell.exec,file.write][grant-check:file.write:src/inherit.ts] Validar herança";

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let sessionId: string | undefined;
    let agentId: string | undefined;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-ph-${randomUUID()}`,
      });
      sessionId = created.sessionId;

      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "run pai" } },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId, runId },
      );

      const spawned = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_SPAWN,
        { objective },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId, runId },
      );
      agentId = spawned.agentId;
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    assert.ok(agentId);
    await waitForAgentNodeState(
      dataRoot,
      WORKSPACE_HELLO.workspaceId,
      runId,
      agentId,
      "complete",
    );

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const node = db.listAgentNodes(runId).find((entry) => entry.id === agentId);
      assert.ok(node?.resultRef);
      const payload = JSON.parse(
        Buffer.from(db.readCasBlob(node.resultRef)).toString("utf8"),
      ) as {
        inheritedGrantPhase: string | null;
        declaredCapabilities: string[];
        objective: string;
      };
      assert.equal(payload.inheritedGrantPhase, "granted");
      assert.deepEqual(payload.declaredCapabilities, ["shell.exec", "file.write"]);
      assert.equal(payload.objective, "Validar herança");
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PER-01] sem grant do pai, ferramenta fica pendente até aceite explícito", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-subagent-grant-pending-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;
    const objective =
      "[declared-caps:file.write][grant-check:file.write:src/pending.ts] Sem grant herdado";

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    let sessionId: string | undefined;
    let agentId: string | undefined;
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-ph-${randomUUID()}`,
      });
      sessionId = created.sessionId;
      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "run pai" } },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId, runId },
      );
      const spawned = await callDaemonRpc(
        socket,
        RPC_METHOD.AGENT_SPAWN,
        { objective },
        { workspaceId: WORKSPACE_HELLO.workspaceId, sessionId, runId },
      );
      agentId = spawned.agentId;
    } finally {
      socket.destroy();
      await runtime.stop();
    }

    await waitForAgentNodeState(
      dataRoot,
      WORKSPACE_HELLO.workspaceId,
      runId,
      agentId!,
      "complete",
    );

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const node = db.listAgentNodes(runId).find((entry) => entry.id === agentId);
      const payload = JSON.parse(
        Buffer.from(db.readCasBlob(node!.resultRef!)).toString("utf8"),
      ) as { inheritedGrantPhase: string | null };
      assert.equal(payload.inheritedGrantPhase, "pending");
    } finally {
      db.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[AGT-05] grant-check inválido retorna INVALID_STATE sem AgentNode", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-subagent-grant-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runId = `run-${randomUUID()}`;

    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const socket = await connectLocalTransport(runtime.address);
    try {
      await performClientHandshake(socket, WORKSPACE_HELLO);
      const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId: `ses-${randomUUID()}`,
        runId: `run-ph-${randomUUID()}`,
      });
      await callDaemonRpc(
        socket,
        RPC_METHOD.RUN_START,
        { input: { text: "run pai" } },
        {
          workspaceId: WORKSPACE_HELLO.workspaceId,
          sessionId: created.sessionId,
          runId,
        },
      );

      await assert.rejects(
        () =>
          callDaemonRpc(
            socket,
            RPC_METHOD.AGENT_SPAWN,
            { objective: "[grant-check:unsupported:target]" },
            {
              workspaceId: WORKSPACE_HELLO.workspaceId,
              sessionId: created.sessionId,
              runId,
            },
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
      const db = openWorkspaceDatabase({
        dataRoot,
        workspaceId: WORKSPACE_HELLO.workspaceId,
      });
      try {
        assert.equal(db.listAgentNodes(runId).length, 0);
      } finally {
        db.close();
        await rm(dataRoot, { recursive: true, force: true });
      }
    }
  });
});
