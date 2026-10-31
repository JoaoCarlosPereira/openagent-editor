import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";
import { readUserDaemonLockPath } from "@openagent/harness-daemon";
import { connectOpenAgentCli, OPENAGENT_CLI_CLIENT_ID } from "../../src/index.js";

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
  workspaceId: "ws-openagent-cli-115",
  workspaceRoot: "/tmp/openagent-workspace-cli-115",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

test.describe("apps/cli → harness-daemon (CLI-01)", { concurrency: 1 }, () => {
  test("[CLI-01] connectOpenAgentCli sob demanda reutiliza provedor, modo, regras, MCP e sessões", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-115-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      const connection = await connectOpenAgentCli({
        workspaceHello: SAMPLE_WORKSPACE_HELLO,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        clientId: OPENAGENT_CLI_CLIENT_ID,
      });

      assert.equal(connection.client.binding.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
      assert.equal(
        connection.client.binding.providerProfileId,
        SAMPLE_WORKSPACE_HELLO.providerProfileId,
      );
      assert.equal(connection.client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
      assert.equal(connection.client.binding.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
      assert.deepEqual(
        connection.client.binding.mcpServerIds,
        SAMPLE_WORKSPACE_HELLO.mcpServerIds,
      );
      assert.deepEqual(connection.client.binding.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);
      assert.equal(connection.workspaceHello.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);

      connection.client.close();
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[CLI-01] segunda conexão da CLI reutiliza configuração já registrada no daemon", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-reuse-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      const first = await connectOpenAgentCli({
        workspaceHello: SAMPLE_WORKSPACE_HELLO,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
      });
      first.client.close();

      const alteredHello = {
        ...SAMPLE_WORKSPACE_HELLO,
        providerProfileId: "provider-should-not-replace",
        mode: "ask",
        rulesRef: "rules:other",
        mcpServerIds: ["other-mcp"],
        sessionIds: ["ses-other"],
      };

      const second = await connectOpenAgentCli({
        workspaceHello: alteredHello,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        spawnDaemon: false,
      });

      // Provedor/modo/regras/MCP permanecem os do primeiro hello (não substituídos).
      assert.equal(second.client.binding.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
      assert.equal(second.client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
      assert.equal(second.client.binding.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
      assert.deepEqual(second.client.binding.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
      // Sessões iniciais são preservadas (merge; novas ids podem ser acrescentadas).
      for (const sessionId of SAMPLE_WORKSPACE_HELLO.sessionIds) {
        assert.ok(second.client.binding.sessionIds.includes(sessionId));
      }
      second.client.close();
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test("[CLI-01] handshake inválido retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    try {
      await assert.rejects(
        () =>
          connectOpenAgentCli({
            workspaceHello: {
              type: "workspace.hello",
              workspaceId: "",
              workspaceRoot: "/tmp/x",
              providerProfileId: "p",
              mode: "agent",
              rulesRef: "rules:x",
              mcpServerIds: [],
              sessionIds: [],
            },
            dataRoot,
            runtimeDirectory,
            spawnDaemon: true,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const lockPath = readUserDaemonLockPath(runtimeDirectory);
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
