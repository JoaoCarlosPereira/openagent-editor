import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";
import { readUserDaemonLockPath } from "@openagent/harness-daemon";
import {
  OPENAGENT_CLI_CLIENT_ID,
  connectOpenAgentCli,
  runOpenAgentCliHeadless,
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

test.describe("apps/cli execução headless persiste sessão (CLI-02)", { concurrency: 1 }, () => {
  test("[CLI-02] após execução headless a sessão aparece ao reabrir o workspace (editor)", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-117-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-ws-117-"));

    const workspaceHello = {
      type: "workspace.hello" as const,
      workspaceId: "ws-openagent-cli-117",
      workspaceRoot,
      providerProfileId: "provider-local-cli-117",
      mode: "ask",
      rulesRef: "rules:project/default",
      mcpServerIds: ["mem0-local"],
      sessionIds: [] as string[],
    };

    try {
      const headless = await runOpenAgentCliHeadless({
        workspaceHello,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        clientId: OPENAGENT_CLI_CLIENT_ID,
        input: { text: "execução headless CLI-02" },
        runId: "run-headless-117",
      });

      assert.equal(headless.workspaceId, workspaceHello.workspaceId);
      assert.equal(headless.runId, "run-headless-117");
      assert.ok(headless.session.sessionId.startsWith("ses-"));
      assert.equal(headless.events.length, 1);
      assert.equal(headless.events[0]?.type, "run.started");
      assert.equal(headless.events[0]?.runId, "run-headless-117");

      // Simula o editor reabrindo o mesmo workspace após a CLI terminar.
      const editor = await connectOpenAgentCli({
        workspaceHello: {
          ...workspaceHello,
          sessionIds: [],
        },
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        spawnDaemon: false,
        clientId: "openagent-editor",
      });

      try {
        assert.ok(
          editor.client.binding.sessionIds.includes(headless.session.sessionId),
          "workspace.ack do editor deve listar a sessão headless da CLI",
        );
      } finally {
        editor.client.close();
      }
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("[CLI-02] entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-cli-117-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-ws-117-invalid-"));

    try {
      await assert.rejects(
        () =>
          runOpenAgentCliHeadless({
            workspaceHello: {
              type: "workspace.hello",
              workspaceId: "ws-cli-117-invalid",
              workspaceRoot,
              providerProfileId: "provider-x",
              mode: "agent",
              rulesRef: "rules:x",
              mcpServerIds: [],
              sessionIds: [],
            },
            dataRoot,
            runtimeDirectory,
            spawnDaemon: true,
            input: { text: "   " },
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
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
