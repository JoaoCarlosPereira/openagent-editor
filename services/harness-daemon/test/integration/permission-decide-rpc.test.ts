import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  writeProtocolFrame,
  type RpcMethod,
  type RpcParamsMap,
  type RpcResultMap,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import {
  createToolPermissionRequest,
  resolvePermissionGrantsPath,
} from "@openagent/policy";
import { startHarnessDaemon } from "../../src/index.js";
import {
  getPermissionService,
  registerPendingToolPermission,
  resetPermissionServicesForTest,
} from "../../src/permissions/permission-service.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-permission-decide-51",
  workspaceRoot: "/tmp/openagent-ws-51",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: [],
  sessionIds: [],
};

type RpcClient = {
  socket: net.Socket;
  call<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
    context?: { sessionId?: string; runId?: string },
  ): Promise<RpcResultMap[M]>;
  close(): void;
};

async function connectRpcClient(address: string): Promise<RpcClient> {
  const socket = await connectLocalTransport(address);
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "permission-decide-test",
      }),
      "utf8",
    ),
  );
  await readProtocolFrame(socket);

  writeProtocolFrame(socket, Buffer.from(JSON.stringify(WORKSPACE), "utf8"));
  const ackFrame = await readProtocolFrame(socket);
  const ackValidation = validateWorkspaceTransportAck(
    JSON.parse(ackFrame.toString("utf8")) as unknown,
  );
  assert.equal(ackValidation.valid, true);

  const sessionId = `ses-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;

  return {
    socket,
    async call(method, params, context = {}) {
      const spec = getRpcMethodSpec(method);
      const requestId = randomUUID();
      const envelope = {
        method,
        requestId,
        workspaceId: WORKSPACE.workspaceId,
        sessionId: context.sessionId ?? sessionId,
        runId: context.runId ?? runId,
        expectedVersion: 0,
        capability: spec.capability,
        payload: params,
        rpcVersion: RPC_PROTOCOL_VERSION,
      };
      const validation = validateRpcRequest(envelope);
      if (!validation.valid) {
        throw new ProtocolError(validation.code, validation.errors.join(" "));
      }
      writeProtocolFrame(socket, Buffer.from(JSON.stringify(validation.value), "utf8"));
      const responseFrame = await readProtocolFrame(socket);
      const response = JSON.parse(responseFrame.toString("utf8")) as {
        type?: string;
        code?: string;
        message?: string;
        requestId?: string;
        result?: RpcResultMap[RpcMethod];
      };
      if (response.type === "protocol.error") {
        throw new ProtocolError(
          (response.code as typeof PROTOCOL_ERROR_CODES.INVALID_STATE) ??
            PROTOCOL_ERROR_CODES.INVALID_STATE,
          response.message ?? "Erro RPC",
        );
      }
      assert.equal(response.type, "rpc.ok");
      return response.result as RpcResultMap[typeof method];
    },
    close() {
      socket.destroy();
    },
  };
}

test.describe("harness-daemon permission.decide RPC", { concurrency: 1 }, () => {
  test("[PER-01] permission.decide allow persiste PermissionGrant no workspace", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-perm-51-"));
    resetPermissionServicesForTest();
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const sessionId = `ses-${randomUUID()}`;
    const permissionRequestId = `perm-${randomUUID()}`;
    const request = createToolPermissionRequest({
      requestId: permissionRequestId,
      capability: "file.write",
      target: { kind: "path", path: "src/main.ts" },
      offeredScopes: ["once", "session"],
    });
    registerPendingToolPermission(dataRoot, WORKSPACE.workspaceId, request, sessionId, "session");

    const client = await connectRpcClient(runtime.address);
    try {
      const result = await client.call(
        RPC_METHOD.PERMISSION_DECIDE,
        { permissionRequestId, decision: "allow", scope: "session" },
        { sessionId },
      );
      assert.equal(result.persisted, true);

      const grantsPath = resolvePermissionGrantsPath(dataRoot, WORKSPACE.workspaceId);
      const onDisk = JSON.parse(readFileSync(grantsPath, "utf8")) as unknown[];
      assert.equal(onDisk.length, 1);
      const grant = onDisk[0] as { grantId: string; scope: string; capability: string };
      assert.equal(grant.grantId, permissionRequestId);
      assert.equal(grant.scope, "session");
      assert.equal(grant.capability, "file.write");

      const service = getPermissionService(dataRoot, WORKSPACE.workspaceId);
      assert.ok(service.getPersistedGrant(permissionRequestId));
    } finally {
      client.close();
      await runtime.stop();
      resetPermissionServicesForTest();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PER-01] permission.decide deny não persiste grant", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-perm-51-deny-"));
    resetPermissionServicesForTest();
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const sessionId = `ses-${randomUUID()}`;
    const permissionRequestId = `perm-${randomUUID()}`;
    registerPendingToolPermission(
      dataRoot,
      WORKSPACE.workspaceId,
      createToolPermissionRequest({
        requestId: permissionRequestId,
        capability: "shell.exec",
        target: { kind: "command", command: "npm test" },
      }),
      sessionId,
    );

    const client = await connectRpcClient(runtime.address);
    try {
      const result = await client.call(
        RPC_METHOD.PERMISSION_DECIDE,
        { permissionRequestId, decision: "deny" },
        { sessionId },
      );
      assert.equal(result.persisted, false);
      const grantsPath = resolvePermissionGrantsPath(dataRoot, WORKSPACE.workspaceId);
      assert.throws(() => readFileSync(grantsPath, "utf8"));
    } finally {
      client.close();
      await runtime.stop();
      resetPermissionServicesForTest();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[PER-01] permission.decide com escopo inválido retorna INVALID_STATE", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-perm-51-bad-"));
    resetPermissionServicesForTest();
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });

    const sessionId = `ses-${randomUUID()}`;
    const permissionRequestId = `perm-${randomUUID()}`;
    registerPendingToolPermission(
      dataRoot,
      WORKSPACE.workspaceId,
      createToolPermissionRequest({
        requestId: permissionRequestId,
        capability: "file.read",
        target: { kind: "path", path: "README.md" },
      }),
      sessionId,
    );

    const client = await connectRpcClient(runtime.address);
    try {
      await assert.rejects(
        () =>
          client.call(
            RPC_METHOD.PERMISSION_DECIDE,
            { permissionRequestId, decision: "allow", scope: "forever" },
            { sessionId },
          ),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );
    } finally {
      client.close();
      await runtime.stop();
      resetPermissionServicesForTest();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
