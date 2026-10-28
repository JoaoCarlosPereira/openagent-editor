import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";
import { readUserDaemonLockPath } from "@openagent/harness-daemon";
import {
  OPENAGENT_CLI_CLIENT_ID,
  OPENAGENT_CLI_WORKSPACE_REUSE_FACETS,
  startOpenAgentCliInWorkspace,
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

async function writeRuleFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

test.describe("apps/cli reutiliza configuração do workspace (CLI-01)", { concurrency: 1 }, () => {
  test("[CLI-01] startOpenAgentCliInWorkspace reutiliza provedor, modo, regras, MCP e sessões", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-116-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-ws-116-"));
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "oa-home-116-"));
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    await writeRuleFile(path.join(fakeHome, ".cursor", "rules", "global.mdc"), "Regra global CLI.");
    await writeRuleFile(
      path.join(workspaceRoot, ".cursor", "rules", "team.mdc"),
      "Regra do projeto CLI.",
    );

    const workspaceHello = {
      type: "workspace.hello" as const,
      workspaceId: "ws-openagent-cli-116",
      workspaceRoot,
      providerProfileId: "provider-local-cli-116",
      mode: "plan",
      rulesRef: "rules:project/default",
      mcpServerIds: ["mem0-local", "filesystem"],
      sessionIds: ["ses-existing-116"],
    };

    try {
      const started = await startOpenAgentCliInWorkspace({
        workspaceHello,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        clientId: OPENAGENT_CLI_CLIENT_ID,
      });

      assert.equal(started.reused.providerProfileId, workspaceHello.providerProfileId);
      assert.equal(started.reused.mode, "plan");
      assert.equal(started.session.mode, "plan");
      assert.equal(started.reused.rulesRef, workspaceHello.rulesRef);
      assert.deepEqual([...started.reused.mcpServerIds], workspaceHello.mcpServerIds);
      assert.ok(started.reused.sessionIds.includes("ses-existing-116"));
      assert.ok(started.reused.sessionIds.includes(started.session.sessionId));
      assert.deepEqual([...started.reused.facets], [...OPENAGENT_CLI_WORKSPACE_REUSE_FACETS]);

      assert.equal(started.connection.client.binding.providerProfileId, workspaceHello.providerProfileId);
      assert.equal(started.connection.client.binding.mode, workspaceHello.mode);
      assert.deepEqual(
        [...started.connection.client.binding.mcpServerIds],
        workspaceHello.mcpServerIds,
      );

      assert.ok(started.reused.loadedRules.length >= 2);
      const origins = started.reused.loadedRules.map((rule) => rule.origin).sort();
      assert.deepEqual(origins, [".cursor/rules/team.mdc", "~/.cursor/rules/global.mdc"]);

      started.connection.client.close();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  test("[CLI-01] segunda partida da CLI reutiliza binding e preserva sessões do workspace", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-116-reuse-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-ws-116-reuse-"));

    const workspaceHello = {
      type: "workspace.hello" as const,
      workspaceId: "ws-openagent-cli-116-reuse",
      workspaceRoot,
      providerProfileId: "provider-first",
      mode: "agent",
      rulesRef: "rules:project/default",
      mcpServerIds: ["mcp-a"],
      sessionIds: ["ses-seed"],
    };

    try {
      const first = await startOpenAgentCliInWorkspace({
        workspaceHello,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
      });
      const firstSessionId = first.session.sessionId;
      first.connection.client.close();

      const second = await startOpenAgentCliInWorkspace({
        workspaceHello: {
          ...workspaceHello,
          providerProfileId: "provider-should-not-replace",
          mode: "ask",
          rulesRef: "rules:other",
          mcpServerIds: ["mcp-other"],
          sessionIds: ["ses-other"],
        },
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        spawnDaemon: false,
      });

      assert.equal(second.reused.providerProfileId, "provider-first");
      assert.equal(second.connection.client.binding.mode, "agent");
      assert.equal(second.reused.rulesRef, "rules:project/default");
      assert.deepEqual([...second.reused.mcpServerIds], ["mcp-a"]);
      assert.ok(second.reused.sessionIds.includes("ses-seed"));
      assert.ok(second.reused.sessionIds.includes(firstSessionId));
      assert.ok(second.reused.sessionIds.includes(second.session.sessionId));
      // Mode da sessão segue o binding reutilizado (agent), não o hello alterado.
      assert.equal(second.session.mode, "agent");

      second.connection.client.close();
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[CLI-01] workspaceRoot inválido retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-116-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const missingRoot = path.join(dataRoot, "missing-workspace-root");

    try {
      await assert.rejects(
        () =>
          startOpenAgentCliInWorkspace({
            workspaceHello: {
              type: "workspace.hello",
              workspaceId: "ws-invalid",
              workspaceRoot: missingRoot,
              providerProfileId: "provider-x",
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
