import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  connectHarnessClient,
  connectLocalTransport,
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  readProtocolFrame,
  writeProtocolFrame,
} from "@openagent/protocol";
import {
  ensureHarnessDaemonReady,
  readUserDaemonLockPath,
  startHarnessDaemon,
} from "../../src/index.js";

async function stopDaemonFromLock(runtimeDirectory: string): Promise<void> {
  const lockPath = readUserDaemonLockPath(runtimeDirectory);
  if (!fs.existsSync(lockPath)) {
    return;
  }
  const record = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number };
  if (typeof record.pid === "number" && record.pid > 0) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // Processo já encerrado.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const SAMPLE_WORKSPACE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-daemon-39",
  workspaceRoot: "/tmp/openagent-workspace-39",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

test("[CLI-01] harness-daemon sob demanda aceita handshake e reutiliza configuração do workspace", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-39-"));
  const runtimeDirectory = path.join(dataRoot, "runtime");

  const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  try {
    const client = await connectHarnessClient({
      address: runtime.address,
      workspaceHello: SAMPLE_WORKSPACE_HELLO,
      clientId: "openagent-cli-test",
    });

    assert.equal(client.binding.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
    assert.equal(client.binding.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
    assert.equal(client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
    assert.equal(client.binding.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
    assert.deepEqual(client.binding.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
    assert.deepEqual(client.binding.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);
    client.close();
  } finally {
    await runtime.stop();
  }

  await rm(dataRoot, { recursive: true, force: true });
});

test("[CLI-01] lock por usuário impede segundo daemon simultâneo (INVALID_STATE)", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-lock-"));
  const runtimeDirectory = path.join(dataRoot, "runtime");

  const first = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  try {
    await assert.rejects(
      () => startHarnessDaemon({ dataRoot, runtimeDirectory }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.match(error.message, /harness-daemon ativo/i);
        return true;
      },
    );
  } finally {
    await first.stop();
  }

  await rm(dataRoot, { recursive: true, force: true });
});

test("[CLI-01] ensureHarnessDaemonReady inicia processo sob demanda e conecta", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-ondemand-"));
  const runtimeDirectory = path.join(dataRoot, "runtime");

  const ready = await ensureHarnessDaemonReady({
    dataRoot,
    runtimeDirectory,
    connectTimeoutMs: 15_000,
  });

  const client = await connectHarnessClient({
    address: ready.address,
    workspaceHello: SAMPLE_WORKSPACE_HELLO,
  });
  assert.equal(client.binding.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
  client.close();

  await assert.rejects(
    () => startHarnessDaemon({ dataRoot, runtimeDirectory }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await stopDaemonFromLock(runtimeDirectory);
  await rm(dataRoot, { recursive: true, force: true });
});

test("[CLI-01] segunda conexão recebe workspace.ack com configuração já registrada no daemon", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-reuse-"));
  const runtimeDirectory = path.join(dataRoot, "runtime");

  const runtime = await startHarnessDaemon({ dataRoot, runtimeDirectory });
  try {
    const first = await connectHarnessClient({
      address: runtime.address,
      workspaceHello: SAMPLE_WORKSPACE_HELLO,
    });
    first.close();

    const alteredHello = {
      ...SAMPLE_WORKSPACE_HELLO,
      providerProfileId: "provider-should-not-replace",
      mode: "ask",
      rulesRef: "rules:other",
      mcpServerIds: ["other-mcp"],
    };

    const socket = await connectLocalTransport(runtime.address);
    writeProtocolFrame(
      socket,
      Buffer.from(
        JSON.stringify({
          type: "protocol.version",
          protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
        }),
        "utf8",
      ),
    );
    await readProtocolFrame(socket);
    writeProtocolFrame(socket, Buffer.from(JSON.stringify(alteredHello), "utf8"));
    const ackBody = await readProtocolFrame(socket);
    const ack = JSON.parse(ackBody.toString("utf8")) as {
      type: string;
      providerProfileId: string;
      mode: string;
      rulesRef: string;
      mcpServerIds: string[];
    };

    assert.equal(ack.type, "workspace.ack");
    assert.equal(ack.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
    assert.equal(ack.mode, SAMPLE_WORKSPACE_HELLO.mode);
    assert.equal(ack.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
    assert.deepEqual(ack.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
    socket.destroy();
  } finally {
    await runtime.stop();
  }

  await rm(dataRoot, { recursive: true, force: true });
});
