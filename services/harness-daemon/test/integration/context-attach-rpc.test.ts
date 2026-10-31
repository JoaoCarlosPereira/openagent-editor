import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_CONTEXT_TOKEN_LIMIT } from "@openagent/context";
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
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";

const WORKSPACE: WorkspaceTransportHello = {
  type: "workspace.hello",
  workspaceId: "ws-context-attach-86",
  workspaceRoot: "/tmp/openagent-context-86",
  providerProfileId: "provider-local",
  mode: "agent",
  rulesRef: "rules:default",
  mcpServerIds: [],
  sessionIds: [],
};

async function connectRpcClient(address: string): Promise<{
  socket: net.Socket;
  call<M extends RpcMethod>(
    method: M,
    params: RpcParamsMap[M],
  ): Promise<RpcResultMap[M]>;
  close(): void;
}> {
  const socket = await connectLocalTransport(address);
  writeProtocolFrame(
    socket,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "context-attach-rpc-test",
      }),
      "utf8",
    ),
  );
  const versionFrame = await readProtocolFrame(socket);
  const versionResponse = JSON.parse(versionFrame.toString("utf8")) as { type?: string };
  assert.equal(versionResponse.type, "protocol.version.ack");

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
    async call(method, params) {
      const spec = getRpcMethodSpec(method);
      const requestId = randomUUID();
      const envelope = {
        method,
        requestId,
        workspaceId: WORKSPACE.workspaceId,
        sessionId,
        runId,
        expectedVersion: 0,
        capability: spec.capability,
        payload: params,
        rpcVersion: RPC_PROTOCOL_VERSION,
      };
      const validation = validateRpcRequest(envelope);
      assert.equal(validation.valid, true);
      writeProtocolFrame(socket, Buffer.from(JSON.stringify(validation.value), "utf8"));

      const response = JSON.parse(
        (await readProtocolFrame(socket)).toString("utf8"),
      ) as Record<string, unknown>;
      if (response.type === "protocol.error") {
        throw new ProtocolError(
          (response.code as typeof PROTOCOL_ERROR_CODES.INVALID_STATE) ??
            PROTOCOL_ERROR_CODES.INVALID_STATE,
          String(response.message ?? "protocol.error"),
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

function seedWorkspace(dataRoot: string, contextLimit: number): void {
  const db = openWorkspaceDatabase({
    dataRoot,
    workspaceId: WORKSPACE.workspaceId,
  });
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    sqlite
      .prepare(
        `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET context_limit = excluded.context_limit`,
      )
      .run(WORKSPACE.workspaceId, WORKSPACE.workspaceRoot, "[]", contextLimit);
  } finally {
    sqlite.close();
    db.close();
  }
}

test("[CTX-01] context.attach via daemon retorna fontes, tokens e teto", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-attach-86-"));
  await mkdir(WORKSPACE.workspaceRoot, { recursive: true });
  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  seedWorkspace(dataRoot, 96_000);

  const runtimeDirectory = path.join(dataRoot, "runtime");
  const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  t.after(async () => {
    await runtime.stop();
  });

  const client = await connectRpcClient(runtime.address);
  t.after(() => {
    client.close();
  });

  const result = await client.call(RPC_METHOD.CONTEXT_ATTACH, {
    attachments: [
      {
        id: "file-1",
        kind: "file",
        path: `${WORKSPACE.workspaceRoot}/a.ts`,
        previewText: "const x = 1;",
      },
      {
        id: "folder-1",
        kind: "folder",
        path: `${WORKSPACE.workspaceRoot}/lib`,
      },
    ],
    messageText: "explique",
  });

  assert.equal(result.sources.length, 2);
  assert.equal(result.contextLimitTokens, 96_000);
  assert.ok(result.totalTokenCount >= result.messageTokenCount);
  assert.equal(result.sources[1]?.tokenCount, 0);
});

test("[CTX-01] context.attach rejeita anexo inválido com INVALID_STATE", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-attach-86-err-"));
  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const runtimeDirectory = path.join(dataRoot, "runtime");
  const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  t.after(async () => {
    await runtime.stop();
  });

  const client = await connectRpcClient(runtime.address);
  t.after(() => {
    client.close();
  });

  await assert.rejects(
    () =>
      client.call(RPC_METHOD.CONTEXT_ATTACH, {
        attachments: [
          {
            id: "sym",
            kind: "symbol",
            path: "/a.ts",
          },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[CTX-01] context.attach sem workspace persistido usa teto API-03", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-attach-86-default-"));
  await mkdir(WORKSPACE.workspaceRoot, { recursive: true });
  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  const runtimeDirectory = path.join(dataRoot, "runtime");
  const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  t.after(async () => {
    await runtime.stop();
  });

  const client = await connectRpcClient(runtime.address);
  t.after(() => {
    client.close();
  });

  const result = await client.call(RPC_METHOD.CONTEXT_ATTACH, {
    attachments: [
      {
        id: "sel",
        kind: "selection",
        path: `${WORKSPACE.workspaceRoot}/b.ts`,
        previewText: "snippet",
      },
    ],
  });

  assert.equal(result.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);
});
