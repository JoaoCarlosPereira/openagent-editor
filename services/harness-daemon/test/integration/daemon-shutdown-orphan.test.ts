import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userInfo } from "node:os";
import {
  connectHarnessClient,
  ProtocolError,
  PROTOCOL_ERROR_CODES,
} from "@openagent/protocol";
import {
  ensureHarnessDaemonReady,
  readUserDaemonLockPath,
  shutdownHarnessDaemonSupervised,
  startHarnessDaemon,
} from "../../src/index.js";

const SAMPLE_WORKSPACE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-daemon-40",
  workspaceRoot: "/tmp/openagent-workspace-40",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

test.describe("harness-daemon shutdown e órfão", { concurrency: 1 }, () => {
  test("[CLI-01] shutdown supervisionado preserva configuração do workspace após reinício", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-40-shutdown-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");

    const first = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    const initialClient = await connectHarnessClient({
      address: first.address,
      workspaceHello: SAMPLE_WORKSPACE_HELLO,
    });
    initialClient.close();
    await first.stop();

    const second = await startHarnessDaemon({ dataRoot, runtimeDirectory });
    try {
      const alteredHello = {
        ...SAMPLE_WORKSPACE_HELLO,
        providerProfileId: "provider-should-not-replace",
        mode: "ask",
        rulesRef: "rules:other",
        mcpServerIds: ["other-mcp"],
      };
      const client = await connectHarnessClient({
        address: second.address,
        workspaceHello: alteredHello,
      });

      assert.equal(client.binding.providerProfileId, SAMPLE_WORKSPACE_HELLO.providerProfileId);
      assert.equal(client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
      assert.equal(client.binding.rulesRef, SAMPLE_WORKSPACE_HELLO.rulesRef);
      assert.deepEqual(client.binding.mcpServerIds, SAMPLE_WORKSPACE_HELLO.mcpServerIds);
      assert.deepEqual(client.binding.sessionIds, SAMPLE_WORKSPACE_HELLO.sessionIds);
      client.close();
    } finally {
      await second.stop();
    }

    await rm(dataRoot, { recursive: true, force: true });
  });

  test("[CLI-01] detecção de daemon órfão libera ensureHarnessDaemonReady", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-40-orphan-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    fs.mkdirSync(runtimeDirectory, { recursive: true });

    const lockPath = readUserDaemonLockPath(runtimeDirectory);
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: 9_999_999,
        username: userInfo().username,
        startedAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );

    const ready = await ensureHarnessDaemonReady({
      dataRoot,
      runtimeDirectory,
      connectTimeoutMs: 15_000,
    });

    const client = await connectHarnessClient({
      address: ready.address,
      workspaceHello: SAMPLE_WORKSPACE_HELLO,
    });
    assert.equal(client.binding.mode, SAMPLE_WORKSPACE_HELLO.mode);
    client.close();

    await shutdownHarnessDaemonSupervised({ dataRoot, runtimeDirectory });
    await rm(dataRoot, { recursive: true, force: true });
  });

  test("[CLI-01] shutdown supervisionado sem daemon retorna INVALID_STATE sem efeito colateral", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-daemon-40-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    fs.mkdirSync(runtimeDirectory, { recursive: true });

    await assert.rejects(
      () => shutdownHarnessDaemonSupervised({ dataRoot, runtimeDirectory }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(fs.existsSync(readUserDaemonLockPath(runtimeDirectory)), false);
    await rm(dataRoot, { recursive: true, force: true });
  });
});
