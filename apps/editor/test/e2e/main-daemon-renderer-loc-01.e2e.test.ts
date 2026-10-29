import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { readUserDaemonLockPath } from "@openagent/harness-daemon";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  EDITOR_MAIN_HELLO_INVALID_MESSAGE,
  ELECTRON_MAIN_DAEMON_REQUIRED_MESSAGE,
  ElectronMainController,
  OPENAGENT_EDITOR_MAIN_CLIENT_ID,
  OPENAGENT_PRODUCT_NAME,
} from "../../src/main/electron-main.js";
import {
  RENDERER_TOOLS_FORBIDDEN_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const SAMPLE_WORKSPACE_HELLO = {
  type: "workspace.hello" as const,
  workspaceId: "ws-openagent-editor-119",
  workspaceRoot: "/tmp/openagent-workspace-editor-119",
  providerProfileId: "provider-local-ollama",
  mode: "agent",
  rulesRef: "rules:project/default",
  mcpServerIds: ["mem0-local", "filesystem"],
  sessionIds: ["ses-main", "ses-side"],
};

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

describe("LOC-01 e2e — main ligado ao daemon; renderer sem ferramentas", { concurrency: 1 }, () => {
  it("processo main conecta ao harness-daemon e o shell marca renderer sem ferramentas", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-editor-119-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const main = new ElectronMainController();
    const shell = new WorkbenchShellController();

    try {
      const launched = main.launch({ platform: "linux" });
      assert.equal(launched.app.name, OPENAGENT_PRODUCT_NAME);
      assert.equal(launched.daemon.connected, false);
      assert.equal(launched.daemon.toolsAllowedInRenderer, false);
      assert.equal(launched.browserWindow.webPreferences.nodeIntegration, false);

      shell.bootstrap({ platform: "linux" });
      assert.equal(shell.snapshot.accessible.daemonConnected, false);
      assert.equal(shell.snapshot.accessible.toolsAllowedInRenderer, false);
      assert.equal(shell.rendererTools.mayInvokeTools, false);

      const connection = await main.connectDaemon({
        workspaceHello: SAMPLE_WORKSPACE_HELLO,
        dataRoot,
        runtimeDirectory,
        connectTimeoutMs: 15_000,
        clientId: OPENAGENT_EDITOR_MAIN_CLIENT_ID,
      });

      assert.equal(connection.processRole, "main");
      assert.equal(connection.toolsAllowedInRenderer, false);
      assert.equal(connection.client.binding.workspaceId, SAMPLE_WORKSPACE_HELLO.workspaceId);
      assert.equal(
        connection.client.binding.providerProfileId,
        SAMPLE_WORKSPACE_HELLO.providerProfileId,
      );
      assert.equal(main.current?.daemon.connected, true);
      assert.equal(main.current?.daemon.toolsAllowedInRenderer, false);

      shell.setDaemonConnected(true);
      assert.match(shell.snapshot.html, /data-testid="workbench-daemon-link"/);
      assert.match(shell.snapshot.html, /data-connected="true"/);
      assert.match(shell.snapshot.html, /data-testid="workbench-renderer-tools"/);
      assert.match(shell.snapshot.html, /data-tools-allowed="false"/);
      assert.match(shell.snapshot.html, /data-tools-allowed-in-renderer="false"/);
      assert.equal(shell.snapshot.accessible.daemonConnected, true);
      assert.equal(shell.snapshot.accessible.toolsAllowedInRenderer, false);

      main.closeDaemon();
      assert.equal(main.current?.daemon.connected, false);
    } finally {
      main.closeDaemon();
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("caminho de erro: renderer que tenta invocar ferramenta recebe PERMISSION_DENIED", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux" });

    assert.throws(
      () => shell.rendererTools.invokeTool("shell.exec"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === PROTOCOL_ERROR_CODES.PERMISSION_DENIED &&
        error.message === RENDERER_TOOLS_FORBIDDEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.toolsAllowedInRenderer, false);
    assert.equal(shell.rendererTools.mayInvokeTools, false);
  });

  it("caminho de erro: hello inválido retorna INVALID_STATE sem efeito colateral no daemon", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "openagent-editor-119-invalid-"));
    const runtimeDirectory = path.join(dataRoot, "runtime");
    const main = new ElectronMainController();

    try {
      main.launch({ platform: "linux" });
      await assert.rejects(
        () =>
          main.connectDaemon({
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
          assert.equal(error.message, EDITOR_MAIN_HELLO_INVALID_MESSAGE);
          return true;
        },
      );

      assert.equal(main.current?.daemon.connected, false);
      assert.equal(main.daemon, null);
      const lockPath = readUserDaemonLockPath(runtimeDirectory);
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      await stopDaemonFromLock(runtimeDirectory);
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("caminho de erro: connectDaemon sem launch retorna INVALID_STATE", async () => {
    const main = new ElectronMainController();
    await assert.rejects(
      () =>
        main.connectDaemon({
          workspaceHello: SAMPLE_WORKSPACE_HELLO,
          spawnDaemon: false,
        }),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === PROTOCOL_ERROR_CODES.INVALID_STATE &&
        error.message === ELECTRON_MAIN_DAEMON_REQUIRED_MESSAGE,
    );
    assert.equal(main.current, null);
  });
});
