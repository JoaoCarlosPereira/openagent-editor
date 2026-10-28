import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  PROTOCOL_ERROR_CODES,
  buildProtocolTransportErrorFrame,
  buildProtocolVersionAck,
  buildWorkspaceTransportAck,
  connectLocalTransport,
  listenLocalTransport,
  readProtocolFrame,
  resolveLocalTransportAddress,
  validateProtocolVersionHello,
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

async function runVersionThenWorkspaceServer(
  address: string,
  onVersion: (parsed: unknown) => void,
): Promise<ReturnType<typeof listenLocalTransport>> {
  return listenLocalTransport(address, async (socket) => {
    const versionFrame = await readProtocolFrame(socket);
    const versionParsed = JSON.parse(versionFrame.toString("utf8")) as unknown;
    onVersion(versionParsed);
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
    socket.end();
  });
}

test("[CLI-01] handshake de versão compatível precede workspace e reutiliza provedor, modo, regras, MCP e sessões", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-version-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-version");

  const server = await runVersionThenWorkspaceServer(address, () => {});

  const client = await connectLocalTransport(address);
  writeProtocolFrame(
    client,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        clientId: "openagent-cli",
      }),
      "utf8",
    ),
  );

  const versionAckBody = await readProtocolFrame(client);
  const versionAck = JSON.parse(versionAckBody.toString("utf8")) as {
    type: string;
    protocolVersion: number;
  };
  assert.equal(versionAck.type, "protocol.version.ack");
  assert.equal(versionAck.protocolVersion, OPENAGENT_DAEMON_PROTOCOL_VERSION);

  writeProtocolFrame(client, Buffer.from(JSON.stringify(SAMPLE_WORKSPACE_HELLO), "utf8"));
  const workspaceAckBody = await readProtocolFrame(client);
  const workspaceAck = JSON.parse(workspaceAckBody.toString("utf8")) as {
    type: string;
    workspaceId: string;
    providerProfileId: string;
    mode: string;
    rulesRef: string;
    mcpServerIds: string[];
    sessionIds: string[];
  };

  assert.equal(workspaceAck.type, "workspace.ack");
  assert.equal(workspaceAck.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
  assert.equal(workspaceAck.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
  assert.equal(workspaceAck.mode, SAMPLE_WORKSPACE_HELLO.mode);
  assert.equal(workspaceAck.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
  assert.deepEqual(workspaceAck.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
  assert.deepEqual(workspaceAck.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);

  client.destroy();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});

test("[CLI-01] cliente com protocolVersion incompatível retorna INVALID_STATE sem ecoar sessões ou workspace", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "openagent-version-bad-"));
  const address = resolveLocalTransportAddress(runtimeDir, "cli-01-version-bad");
  let sawWorkspaceHello = false;

  const server = await runVersionThenWorkspaceServer(address, (parsed) => {
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: string }).type === "workspace.hello"
    ) {
      sawWorkspaceHello = true;
    }
  });

  const client = await connectLocalTransport(address);
  writeProtocolFrame(
    client,
    Buffer.from(
      JSON.stringify({
        type: "protocol.version",
        protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION + 99,
      }),
      "utf8",
    ),
  );

  const responseBody = await readProtocolFrame(client);
  const errorFrame = JSON.parse(responseBody.toString("utf8")) as {
    type: string;
    code: string;
    message: string;
  };

  assert.equal(errorFrame.type, "protocol.error");
  assert.equal(errorFrame.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.match(errorFrame.message, /incompatível|protocolVersion/i);
  assert.equal("sessionIds" in errorFrame, false);
  assert.equal("workspaceId" in errorFrame, false);
  assert.equal(sawWorkspaceHello, false);

  client.destroy();
  await server.close();
  await rm(runtimeDir, { recursive: true, force: true });
});
