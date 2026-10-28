import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  USER_INPUT_EMPTY_MESSAGE,
  buildHarnessRpcOkFrame,
  buildProtocolTransportErrorFrame,
  buildProtocolVersionAck,
  buildWorkspaceTransportAck,
  connectHarnessClient,
  listenLocalTransport,
  readProtocolFrame,
  resolveLocalTransportAddress,
  validateProtocolVersionHello,
  validateRpcRequest,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
} from "../../src/index.js";

const SAMPLE_WORKSPACE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-dev",
  workspaceRoot: "/tmp/openagent-workspace",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

async function handshakeThenRpcServer(
  address: string,
  onRpc: (
    envelope: { method: string; workspaceId: string; requestId: string },
  ) => { ok: true; result: unknown } | { ok: false; message: string },
): Promise<ReturnType<typeof listenLocalTransport>> {
  return listenLocalTransport(address, async (socket) => {
    const versionFrame = await readProtocolFrame(socket);
    const versionParsed = JSON.parse(versionFrame.toString("utf8")) as unknown;
    const versionValidation = validateProtocolVersionHello(versionParsed);
    if (!versionValidation.valid) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              versionValidation.code,
              versionValidation.errors.join(" "),
            ),
          ),
          "utf8",
        ),
      );
      socket.end();
      return;
    }

    writeProtocolFrame(
      socket,
      Buffer.from(
        JSON.stringify(buildProtocolVersionAck(versionValidation.value)),
        "utf8",
      ),
    );

    const workspaceFrame = await readProtocolFrame(socket);
    const workspaceParsed = JSON.parse(workspaceFrame.toString("utf8")) as unknown;
    const workspaceValidation = validateWorkspaceTransportHello(workspaceParsed);
    if (!workspaceValidation.valid) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              workspaceValidation.code,
              workspaceValidation.errors.join(" "),
            ),
          ),
          "utf8",
        ),
      );
      socket.end();
      return;
    }

    writeProtocolFrame(
      socket,
      Buffer.from(JSON.stringify(buildWorkspaceTransportAck(workspaceValidation.value)), "utf8"),
    );

    const rpcFrame = await readProtocolFrame(socket);
    const rpcParsed = JSON.parse(rpcFrame.toString("utf8")) as unknown;
    const rpcValidation = validateRpcRequest(rpcParsed);
    if (!rpcValidation.valid) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              rpcValidation.code,
              rpcValidation.errors.join(" "),
            ),
          ),
          "utf8",
        ),
      );
      socket.end();
      return;
    }

    const outcome = onRpc({
      method: rpcValidation.value.method,
      workspaceId: rpcValidation.value.workspaceId,
      requestId: rpcValidation.value.requestId,
    });
    if (!outcome.ok) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              PROTOCOL_ERROR_CODES.INVALID_STATE,
              outcome.message,
            ),
          ),
          "utf8",
        ),
      );
      socket.end();
      return;
    }

    writeProtocolFrame(
      socket,
      Buffer.from(
        JSON.stringify(
          buildHarnessRpcOkFrame(rpcValidation.value.requestId, outcome.result as never),
        ),
        "utf8",
      ),
    );
    socket.end();
  });
}

test("[CLI-01] HarnessClient tipado reutiliza provedor, modo, regras, MCP e sessões do workspace", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-harness-client-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-harness");

  const server = await handshakeThenRpcServer(address, (envelope) => {
    assert.equal(envelope.method, RPC_METHOD.SESSION_CREATE);
    assert.equal(envelope.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
    return {
      ok: true,
      result: {
        sessionId: "ses-created-01",
        workspaceId: SAMPLE_WORKSPACE_HELLO.workspaceId,
        mode: "agent",
        loadedRules: [],
        rulesLoaded: {
          type: "session.rules.loaded",
          sessionId: "ses-created-01",
          rulesRef: SAMPLE_WORKSPACE_HELLO.rulesRef,
          loadedRules: [],
          emittedAt: 1,
        },
      },
    };
  });

  const client = await connectHarnessClient({
    address,
    workspaceHello: SAMPLE_WORKSPACE_HELLO,
    clientId: "openagent-cli",
  });

  assert.equal(client.binding.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
  assert.equal(client.binding.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
  assert.equal(client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
  assert.equal(client.binding.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
  assert.deepEqual(client.binding.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
  assert.deepEqual(client.binding.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);

  const session = await client.createSession({ mode: "agent" });
  assert.equal(session.sessionId, "ses-created-01");
  assert.equal(session.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
  assert.equal(session.mode, "agent");
  assert.equal(session.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
  assert.equal(session.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
  assert.deepEqual(session.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
  assert.deepEqual(session.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);

  client.close();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

async function handshakeOnlyServer(
  address: string,
): Promise<ReturnType<typeof listenLocalTransport>> {
  return listenLocalTransport(address, async (socket) => {
    try {
      const versionFrame = await readProtocolFrame(socket);
      const versionParsed = JSON.parse(versionFrame.toString("utf8")) as unknown;
      const versionValidation = validateProtocolVersionHello(versionParsed);
      if (!versionValidation.valid) {
        return;
      }
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(buildProtocolVersionAck(versionValidation.value)),
          "utf8",
        ),
      );
      const workspaceFrame = await readProtocolFrame(socket);
      const workspaceParsed = JSON.parse(workspaceFrame.toString("utf8")) as unknown;
      const workspaceValidation = validateWorkspaceTransportHello(workspaceParsed);
      if (!workspaceValidation.valid) {
        return;
      }
      writeProtocolFrame(
        socket,
        Buffer.from(JSON.stringify(buildWorkspaceTransportAck(workspaceValidation.value)), "utf8"),
      );
    } catch {
      // cliente pode encerrar após validação local sem enviar RPC
    }
  });
}

test("[CLI-01] entrada inválida em enqueue retorna INVALID_STATE sem alterar binding do workspace", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-harness-client-bad-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-harness-bad");

  const server = await handshakeOnlyServer(address);

  const client = await connectHarnessClient({
    address,
    workspaceHello: SAMPLE_WORKSPACE_HELLO,
  });

  const bindingBefore = { ...client.binding, mcpServerIds: [...client.binding.mcpServerIds] };

  await assert.rejects(
    () => client.enqueue("run-test", { text: "" }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.match(error.message, new RegExp(USER_INPUT_EMPTY_MESSAGE, "i"));
      return true;
    },
  );

  assert.equal(client.binding.workspaceId, bindingBefore.workspaceId);
  assert.equal(client.binding.providerProfileId, bindingBefore.providerProfileId);
  assert.deepEqual(client.binding.mcpServerIds, bindingBefore.mcpServerIds);
  assert.deepEqual(client.binding.sessionIds, bindingBefore.sessionIds);

  client.close();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

test("[CLI-01] workspace.hello inválido falha antes de RPC com INVALID_STATE", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-harness-client-hello-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-harness-hello");

  let versionFrameReceived = false;
  const server = await listenLocalTransport(address, async (socket) => {
    try {
      await readProtocolFrame(socket);
      versionFrameReceived = true;
    } catch {
      // cliente valida workspace localmente e fecha antes de enviar protocol.version
    }
  });

  await assert.rejects(
    () =>
      connectHarnessClient({
        address,
        workspaceHello: {
          ...SAMPLE_WORKSPACE_HELLO,
          workspaceId: "",
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.equal(versionFrameReceived, false);
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});
