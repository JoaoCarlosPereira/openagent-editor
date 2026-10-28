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
import {
  PROJECT_ACCEPTED_EVENT,
  PROJECT_REJECTED_EVENT,
} from "../../src/projects/project-accept-reject.js";

const WORKSPACE_HELLO: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-project-accept-114",
  workspaceRoot: "/tmp/openagent-project-accept",
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
        clientId: "project-accept-reject-rpc-test",
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

async function callDaemonRpcExpectError(
  socket: net.Socket,
  method: RpcMethod,
  params: RpcParamsMap[RpcMethod],
  context: {
    workspaceId: string;
    sessionId: string;
    runId: string;
  },
): Promise<ProtocolError> {
  try {
    await callDaemonRpc(socket, method, params, context);
    assert.fail("esperava protocol.error");
  } catch (error) {
    assert.ok(error instanceof ProtocolError);
    return error;
  }
}

async function waitForProjectTaskResults(
  dataRoot: string,
  workspaceId: string,
  runId: string,
  projectId: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    try {
      const nodes = db.listAgentNodes(runId);
      const children = nodes.filter((node) => node.parentId === projectId);
      if (
        children.length >= 2 &&
        children.every((node) => node.state === "complete" && node.resultRef)
      ) {
        return;
      }
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timeout aguardando resultados do projeto ${projectId}`);
}

async function createProjectWithPendingResults(input: {
  dataRoot: string;
  runtimeDirectory: string;
  objective?: string;
}): Promise<{
  sessionId: string;
  runId: string;
  projectId: string;
  taskNodeIds: string[];
}> {
  const runId = `run-${randomUUID()}`;
  const objective =
    input.objective ?? "TASK: Mapear APIs\nTASK: Implementar cliente\nTASK: Cobrir testes";

  const runtime = await startHarnessDaemon({
    dataRoot: input.dataRoot,
    runtimeDirectory: input.runtimeDirectory,
  });
  const socket = await connectLocalTransport(runtime.address);
  let sessionId: string | undefined;
  let projectId: string | undefined;
  try {
    await performClientHandshake(socket, WORKSPACE_HELLO);

    const created = await callDaemonRpc(socket, RPC_METHOD.SESSION_CREATE, { mode: "agent" }, {
      workspaceId: WORKSPACE_HELLO.workspaceId,
      sessionId: `ses-placeholder-${randomUUID()}`,
      runId: `run-placeholder-${randomUUID()}`,
    });
    sessionId = created.sessionId;

    await callDaemonRpc(
      socket,
      RPC_METHOD.RUN_START,
      { input: { text: "início projeto local" } },
      {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId,
        runId,
      },
    );

    const project = await callDaemonRpc(
      socket,
      RPC_METHOD.PROJECT_CREATE,
      { objective },
      {
        workspaceId: WORKSPACE_HELLO.workspaceId,
        sessionId,
        runId,
      },
    );
    projectId = project.projectId;
  } finally {
    socket.destroy();
    await runtime.stop();
  }

  assert.ok(sessionId);
  assert.ok(projectId);
  await waitForProjectTaskResults(
    input.dataRoot,
    WORKSPACE_HELLO.workspaceId,
    runId,
    projectId,
  );

  const db = openWorkspaceDatabase({
    dataRoot: input.dataRoot,
    workspaceId: WORKSPACE_HELLO.workspaceId,
  });
  try {
    const children = db
      .listAgentNodes(runId)
      .filter((node) => node.parentId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.ok(children.length >= 2);
    return {
      sessionId,
      runId,
      projectId,
      taskNodeIds: children.map((node) => node.id),
    };
  } finally {
    db.close();
  }
}

function readReviewStatus(
  dataRoot: string,
  workspaceId: string,
  runId: string,
  nodeId: string,
): string {
  const db = openWorkspaceDatabase({ dataRoot, workspaceId });
  try {
    const node = db.listAgentNodes(runId).find((item) => item.id === nodeId);
    assert.ok(node?.resultRef);
    const restored = JSON.parse(
      Buffer.from(db.readCasBlob(node.resultRef)).toString("utf8"),
    ) as { reviewStatus: string };
    return restored.reviewStatus;
  } finally {
    db.close();
  }
}

function listEventTypes(
  dataRoot: string,
  workspaceId: string,
  runId: string,
): string[] {
  const db = openWorkspaceDatabase({ dataRoot, workspaceId });
  try {
    return db.listHarnessEvents(runId).map((event) => event.type);
  } finally {
    db.close();
  }
}

test.describe("project.accept/reject RPC (PRJ-01)", { concurrency: 1 }, () => {
  test("[PRJ-01] project.accept/reject por resultado muda reviewStatus observável", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-project-accept-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      const created = await createProjectWithPendingResults({ dataRoot, runtimeDirectory });
      const [acceptNodeId, rejectNodeId] = created.taskNodeIds;
      assert.ok(acceptNodeId);
      assert.ok(rejectNodeId);

      assert.equal(
        readReviewStatus(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId, acceptNodeId),
        "pending",
      );

      const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
      const socket = await connectLocalTransport(runtime.address);
      try {
        await performClientHandshake(socket, WORKSPACE_HELLO);

        const accepted = await callDaemonRpc(
          socket,
          RPC_METHOD.PROJECT_ACCEPT,
          { nodeId: acceptNodeId },
          {
            workspaceId: WORKSPACE_HELLO.workspaceId,
            sessionId: created.sessionId,
            runId: created.runId,
          },
        );
        assert.deepEqual(accepted, { accepted: true });

        const rejected = await callDaemonRpc(
          socket,
          RPC_METHOD.PROJECT_REJECT,
          { nodeId: rejectNodeId },
          {
            workspaceId: WORKSPACE_HELLO.workspaceId,
            sessionId: created.sessionId,
            runId: created.runId,
          },
        );
        assert.deepEqual(rejected, { rejected: true });
      } finally {
        socket.destroy();
        await runtime.stop();
      }

      assert.equal(
        readReviewStatus(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId, acceptNodeId),
        "accepted",
      );
      assert.equal(
        readReviewStatus(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId, rejectNodeId),
        "rejected",
      );

      const eventTypes = listEventTypes(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId);
      assert.ok(eventTypes.includes(PROJECT_ACCEPTED_EVENT));
      assert.ok(eventTypes.includes(PROJECT_REJECTED_EVENT));
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PRJ-01] accept repetido retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-project-accept-err-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      const created = await createProjectWithPendingResults({ dataRoot, runtimeDirectory });
      const nodeId = created.taskNodeIds[0];
      assert.ok(nodeId);

      const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
      const socket = await connectLocalTransport(runtime.address);
      try {
        await performClientHandshake(socket, WORKSPACE_HELLO);

        await callDaemonRpc(
          socket,
          RPC_METHOD.PROJECT_ACCEPT,
          { nodeId },
          {
            workspaceId: WORKSPACE_HELLO.workspaceId,
            sessionId: created.sessionId,
            runId: created.runId,
          },
        );

        const beforeRef = (() => {
          const db = openWorkspaceDatabase({
            dataRoot,
            workspaceId: WORKSPACE_HELLO.workspaceId,
          });
          try {
            return db.listAgentNodes(created.runId).find((node) => node.id === nodeId)?.resultRef;
          } finally {
            db.close();
          }
        })();
        assert.ok(beforeRef);

        const error = await callDaemonRpcExpectError(
          socket,
          RPC_METHOD.PROJECT_ACCEPT,
          { nodeId },
          {
            workspaceId: WORKSPACE_HELLO.workspaceId,
            sessionId: created.sessionId,
            runId: created.runId,
          },
        );
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);

        const afterRef = (() => {
          const db = openWorkspaceDatabase({
            dataRoot,
            workspaceId: WORKSPACE_HELLO.workspaceId,
          });
          try {
            return db.listAgentNodes(created.runId).find((node) => node.id === nodeId)?.resultRef;
          } finally {
            db.close();
          }
        })();
        assert.equal(afterRef, beforeRef);
        assert.equal(
          readReviewStatus(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId, nodeId),
          "accepted",
        );
      } finally {
        socket.destroy();
        await runtime.stop();
      }
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PRJ-01] nodeId inexistente retorna INVALID_STATE", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-project-accept-missing-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      const created = await createProjectWithPendingResults({ dataRoot, runtimeDirectory });
      const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
      const socket = await connectLocalTransport(runtime.address);
      try {
        await performClientHandshake(socket, WORKSPACE_HELLO);
        const error = await callDaemonRpcExpectError(
          socket,
          RPC_METHOD.PROJECT_REJECT,
          { nodeId: randomUUID() },
          {
            workspaceId: WORKSPACE_HELLO.workspaceId,
            sessionId: created.sessionId,
            runId: created.runId,
          },
        );
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      } finally {
        socket.destroy();
        await runtime.stop();
      }

      for (const nodeId of created.taskNodeIds) {
        assert.equal(
          readReviewStatus(dataRoot, WORKSPACE_HELLO.workspaceId, created.runId, nodeId),
          "pending",
        );
      }
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
