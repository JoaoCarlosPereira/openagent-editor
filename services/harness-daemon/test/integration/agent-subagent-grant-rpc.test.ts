import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import {
  createToolPermissionRequest,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
} from "@openagent/policy";
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
  validateWorkspaceTransportHello,
  writeProtocolFrame,
  type ProtocolErrorCode,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  prepareSubagentRunToolPermission,
  recordParentRunToolGrant,
} from "../../src/agents/agent-subagent-grants.js";
import { createWorkspaceCustomizationRules } from "../../src/customization/session-rules-loader.js";
import type { DaemonRpcContext } from "../../src/runs/run-rpc-handler.js";
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

function buildGrantTestContext(workspaceId: string): DaemonRpcContext {
  return {
    dataRoot: "/tmp/openagent-subagent-grant-unused",
    binding: {
      workspaceId,
      workspaceRoot: "/tmp/openagent-subagent-grant",
      providerProfileId: "provider-local",
      mode: "agent",
      rulesRef: "rules:default",
      mcpServerIds: [],
      sessionIds: [],
    },
    customizationRules: createWorkspaceCustomizationRules(),
    runMachines: new Map(),
    runQueues: new Map(),
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
  test("[AGT-05][PER-01] herança via recordParentRunToolGrant após aceite explícito (once)", () => {
    const runId = `run-${randomUUID()}`;
    const sessionId = `ses-${randomUUID()}`;
    const context = buildGrantTestContext("ws-subagent-grant-inherit");

    const parentRequest = createToolPermissionRequest({
      requestId: "parent-allow-write",
      capability: "file.write",
      target: { kind: "path", path: "src/inherit.ts" },
      offeredScopes: ["once", "session", "workspace"],
    });
    const resolvedGate = resolvePermissionExecutionGate(
      openPermissionExecutionGate(parentRequest, "once"),
      "allow",
      "once",
    );
    assert.equal(resolvedGate.phase, "resolved");
    recordParentRunToolGrant(context, runId, sessionId, resolvedGate);

    const prepared = prepareSubagentRunToolPermission(
      context,
      {
        runId,
        sessionId,
        request: {
          requestId: "subagent-grant-check",
          capability: "file.write",
          target: { kind: "path", path: "src/inherit.ts" },
        },
      },
      ["shell.exec", "file.write"],
    );
    assert.equal(prepared.phase, "granted");

    const amplified = prepareSubagentRunToolPermission(
      context,
      {
        runId,
        sessionId,
        request: {
          requestId: "subagent-shell-check",
          capability: "shell.exec",
          target: { kind: "command", command: "npm test" },
        },
      },
      ["shell.exec", "file.write"],
    );
    assert.equal(amplified.phase, "pending");
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

    assert.ok(agentId);
    const completedAgentId = agentId;
    await waitForAgentNodeState(
      dataRoot,
      WORKSPACE_HELLO.workspaceId,
      runId,
      completedAgentId,
      "complete",
    );

    const db = openWorkspaceDatabase({
      dataRoot,
      workspaceId: WORKSPACE_HELLO.workspaceId,
    });
    try {
      const node = db.listAgentNodes(runId).find((entry) => entry.id === completedAgentId);
      assert.ok(node);
      assert.ok(node.resultRef);
      const payload = JSON.parse(
        Buffer.from(db.readCasBlob(node.resultRef)).toString("utf8"),
      ) as { inheritedGrantPhase: string | null; objective: string };
      assert.equal(payload.inheritedGrantPhase, "pending");
      assert.equal(payload.objective, "Sem grant herdado");
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
