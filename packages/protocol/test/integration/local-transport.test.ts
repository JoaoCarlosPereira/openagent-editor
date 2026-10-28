import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  buildProtocolTransportErrorFrame,
  buildWorkspaceTransportAck,
  connectLocalTransport,
  listenLocalTransport,
  readProtocolFrame,
  resolveLocalTransportAddress,
  validateWorkspaceTransportHello,
  writeProtocolFrame,
} from "../../src/index.js";

const SAMPLE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-dev",
  workspaceRoot: "/tmp/openagent-workspace",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

test("[CLI-01] transporte local com framing reutiliza provedor, modo, regras, MCP e sessões do workspace", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-transport-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01");

  const server = await listenLocalTransport(address, async (socket) => {
    const frame = await readProtocolFrame(socket);
    const parsed = JSON.parse(frame.toString("utf8")) as unknown;
    const validation = validateWorkspaceTransportHello(parsed);
    if (!validation.valid) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              validation.code,
              validation.errors.join(" "),
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
      Buffer.from(JSON.stringify(buildWorkspaceTransportAck(validation.value)), "utf8"),
    );
    socket.end();
  });

  const client = await connectLocalTransport(address);
  writeProtocolFrame(client, Buffer.from(JSON.stringify(SAMPLE_HELLO), "utf8"));
  const responseBody = await readProtocolFrame(client);
  const ack = JSON.parse(responseBody.toString("utf8")) as {
    type: string;
    workspaceId: string;
    providerProfileId: string;
    mode: string;
    rulesRef: string;
    mcpServerIds: string[];
    sessionIds: string[];
  };

  assert.equal(ack.type, "workspace.ack");
  assert.equal(ack.workspaceId, SAMPLE_HELLO.workspaceId);
  assert.equal(ack.providerProfileId, SAMPLE_HELLO.providerProfileId);
  assert.equal(ack.mode, SAMPLE_HELLO.mode);
  assert.equal(ack.rulesRef, SAMPLE_HELLO.rulesRef);
  assert.deepEqual(ack.mcpServerIds, SAMPLE_HELLO.mcpServerIds);
  assert.deepEqual(ack.sessionIds, SAMPLE_HELLO.sessionIds);

  client.destroy();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

test("[CLI-01] handshake inválido retorna INVALID_STATE sem ecoar sessões", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-transport-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-error");

  const server = await listenLocalTransport(address, async (socket) => {
    const frame = await readProtocolFrame(socket);
    const parsed = JSON.parse(frame.toString("utf8")) as unknown;
    const validation = validateWorkspaceTransportHello(parsed);
    if (!validation.valid) {
      writeProtocolFrame(
        socket,
        Buffer.from(
          JSON.stringify(
            buildProtocolTransportErrorFrame(
              validation.code,
              validation.errors[0] ?? "Estado inválido.",
            ),
          ),
          "utf8",
        ),
      );
    }
    socket.end();
  });

  const client = await connectLocalTransport(address);
  writeProtocolFrame(
    client,
    Buffer.from(JSON.stringify({ type: "workspace.hello", workspaceId: "" }), "utf8"),
  );
  const responseBody = await readProtocolFrame(client);
  const errorFrame = JSON.parse(responseBody.toString("utf8")) as {
    type: string;
    code: string;
    message: string;
  };

  assert.equal(errorFrame.type, "protocol.error");
  assert.equal(errorFrame.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.match(errorFrame.message, /workspaceId/i);
  assert.equal("sessionIds" in errorFrame, false);

  client.destroy();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

test("[CLI-01] frame com tamanho declarado inválido falha com INVALID_STATE", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-transport-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-frame");

  const server = await listenLocalTransport(address, async (socket) => {
    try {
      await readProtocolFrame(socket);
    } catch (error) {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      socket.end();
    }
  });

  const client = await connectLocalTransport(address);
  const bogusHeader = Buffer.alloc(4);
  bogusHeader.writeUInt32BE(64 * 1024 * 1024, 0);
  client.write(bogusHeader);
  await new Promise<void>((resolve) => client.once("close", () => resolve()));
  client.destroy();

  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

test("resolveLocalTransportAddress usa named pipe no Windows e socket Unix nos demais SOs", () => {
  const runtimeDir = "/var/run/openagent";
  if (process.platform === "win32") {
    assert.match(resolveLocalTransportAddress(runtimeDir), /^\\\\\.\\pipe\\/);
  } else {
    assert.equal(
      resolveLocalTransportAddress(runtimeDir, "dev"),
      path.join(runtimeDir, "openagent-harness-dev.sock"),
    );
  }
});
