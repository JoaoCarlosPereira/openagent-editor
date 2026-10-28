import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ProtocolError } from "@openagent/protocol";

import {
  ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
  ElectronMainController,
  OPENAGENT_PRODUCT_NAME,
} from "../../src/main/electron-main.js";
import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  TERMINAL_COMMAND_REQUIRED_MESSAGE,
  TERMINAL_NO_SESSION_MESSAGE,
  TERMINAL_NOT_A_DIRECTORY_MESSAGE,
  WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function createFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-terminal-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
  writeFileSync(path.join(root, "src", "main.ts"), "console.log(1);\n", "utf8");
  return root;
}

describe("LOC-01 e2e — Terminal integrado", () => {
  it("main abre terminal na pasta e executa comando com saída observável", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      main.openFolder(fixture);

      const opened = main.openTerminal();
      assert.ok(opened.session.id.length > 0);
      assert.equal(opened.session.relativeCwd, "");
      assert.equal(opened.session.cwd, path.resolve(fixture));
      assert.equal(opened.session.output, "");
      assert.equal(opened.session.status, "idle");
      assert.equal(opened.view.accessible.productName, OPENAGENT_PRODUCT_NAME);
      assert.match(opened.view.html, /data-testid="workbench-slot-terminal"/);
      assert.match(opened.view.html, /data-terminal-open="true"/);
      assert.match(opened.view.html, /data-testid="terminal-output"/);
      assert.match(opened.view.html, /data-testid="terminal-input"/);
      assert.equal(opened.view.accessible.terminal.open, true);
      assert.equal(opened.view.accessible.terminal.relativeCwd, "");

      const ran = main.runTerminalCommand("printf 'hello-openagent\\n'");
      assert.equal(ran.session.lastCommand, "printf 'hello-openagent\\n'");
      assert.equal(ran.session.lastExitCode, 0);
      assert.equal(ran.session.status, "exited");
      assert.match(ran.session.output, /hello-openagent/);
      assert.match(ran.view.html, /hello-openagent/);
      assert.match(ran.view.html, /data-testid="terminal-last-command"/);
      assert.equal(ran.view.accessible.terminal.lastExitCode, 0);
      assert.ok(ran.view.accessible.terminal.outputLength > 0);

      const nested = main.setTerminalCwd("src");
      assert.equal(nested.session.relativeCwd, "src");
      assert.equal(nested.session.cwd, path.resolve(fixture, "src"));
      assert.match(nested.view.html, /data-relative-cwd="src"/);

      const listed = main.runTerminalCommand("printf '%s\\n' main.ts");
      assert.equal(listed.session.lastExitCode, 0);
      assert.match(listed.session.output, /main\.ts/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: estado inválido e fora do escopo sem efeito colateral", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      assert.throws(
        () => main.openTerminal(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );

      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      assert.match(main.shell.snapshot.html, /Abra o terminal na pasta do workspace/);
      assert.equal(main.shell.snapshot.accessible.terminal.open, false);

      assert.throws(
        () => main.openTerminal(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE,
      );

      main.openFolder(fixture);
      const beforeOpen = main.shell.snapshot.accessible.terminal.open;

      assert.throws(
        () => main.runTerminalCommand("echo x"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TERMINAL_NO_SESSION_MESSAGE,
      );
      assert.equal(main.shell.snapshot.accessible.terminal.open, beforeOpen);

      main.openTerminal();
      const beforeBad = main.shell.openTerminalSession?.output ?? "";

      assert.throws(
        () => main.runTerminalCommand("   "),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TERMINAL_COMMAND_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.runTerminalCommand(null),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TERMINAL_COMMAND_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.setTerminalCwd("../outside"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "OUT_OF_SCOPE" &&
          error.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );
      assert.throws(
        () => main.setTerminalCwd("README.md"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TERMINAL_NOT_A_DIRECTORY_MESSAGE,
      );

      assert.equal(main.shell.openTerminalSession?.output, beforeBad);
      assert.equal(main.shell.openTerminalSession?.relativeCwd, "");
      assert.equal(main.shell.openTerminalSession?.lastCommand, null);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: terminal sem pasta aberta retorna INVALID_STATE", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });
    assert.throws(
      () => shell.openTerminal(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.throws(
      () => shell.runTerminalCommand("echo x"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.terminal.open, false);
  });
});
