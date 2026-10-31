import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  GIT_PANEL_NO_PANEL_MESSAGE,
  GIT_PANEL_NOT_A_REPOSITORY_MESSAGE,
  GIT_PANEL_PATH_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function createGitFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-git-panel-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
  writeFileSync(path.join(root, "src", "main.ts"), "console.log(1);\n", "utf8");
  git(root, ["init"]);
  git(root, ["config", "user.email", "dev@openagent.local"]);
  git(root, ["config", "user.name", "OpenAgent Dev"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  writeFileSync(path.join(root, "README.md"), "# fixture changed\n", "utf8");
  return root;
}

function createNonGitFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-git-none-"));
  writeFileSync(path.join(root, "README.md"), "# no git\n", "utf8");
  return root;
}

describe("LOC-01 e2e — Painel Git com status e diff", () => {
  it("main abre painel Git na pasta e mostra status e diff observáveis", () => {
    const fixture = createGitFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      main.openFolder(fixture);

      const opened = main.openGit();
      assert.ok(opened.panel.id.length > 0);
      assert.equal(opened.panel.workspaceRoot, path.resolve(fixture));
      assert.equal(opened.panel.statusCommand, "git status --porcelain=v1 -b");
      assert.equal(opened.panel.statusExitCode, 0);
      assert.match(opened.panel.statusStdout, /README\.md/);
      assert.equal(opened.panel.diffCommand, null);
      assert.equal(opened.view.accessible.productName, OPENAGENT_PRODUCT_NAME);
      assert.match(opened.view.html, /data-testid="workbench-slot-git"/);
      assert.match(opened.view.html, /data-git-open="true"/);
      assert.match(opened.view.html, /data-testid="git-status"/);
      assert.match(opened.view.html, /data-testid="git-diff"/);
      assert.equal(opened.view.accessible.git.open, true);
      assert.ok((opened.view.accessible.git.statusLength ?? 0) > 0);

      const withDiff = main.loadGitDiff();
      assert.equal(withDiff.panel.diffCommand, "git diff");
      assert.equal(withDiff.panel.diffRelativePath, null);
      assert.equal(withDiff.panel.diffExitCode, 0);
      assert.match(withDiff.panel.diffStdout, /fixture changed/);
      assert.match(withDiff.view.html, /fixture changed/);
      assert.match(withDiff.view.html, /data-testid="git-last-diff-command"/);
      assert.equal(withDiff.view.accessible.git.diffExitCode, 0);
      assert.ok((withDiff.view.accessible.git.diffLength ?? 0) > 0);

      const pathDiff = main.loadGitDiff("README.md");
      assert.equal(pathDiff.panel.diffCommand, "git diff -- README.md");
      assert.equal(pathDiff.panel.diffRelativePath, "README.md");
      assert.match(pathDiff.panel.diffStdout, /fixture changed/);

      writeFileSync(path.join(fixture, "src", "main.ts"), "console.log(2);\n", "utf8");
      const refreshed = main.refreshGitStatus();
      assert.equal(refreshed.panel.statusExitCode, 0);
      assert.match(refreshed.panel.statusStdout, /src\/main\.ts/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: estado inválido e fora do escopo sem efeito colateral", () => {
    const fixture = createGitFixtureWorkspace();
    const nonGit = createNonGitFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      assert.throws(
        () => main.openGit(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );

      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      assert.match(main.shell.snapshot.html, /Abra o painel Git na pasta do workspace/);
      assert.equal(main.shell.snapshot.accessible.git.open, false);

      assert.throws(
        () => main.openGit(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE,
      );

      main.openFolder(nonGit);
      assert.throws(
        () => main.openGit(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === GIT_PANEL_NOT_A_REPOSITORY_MESSAGE,
      );
      assert.equal(main.shell.snapshot.accessible.git.open, false);

      main.openFolder(fixture);
      const beforeOpen = main.shell.snapshot.accessible.git.open;

      assert.throws(
        () => main.refreshGitStatus(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === GIT_PANEL_NO_PANEL_MESSAGE,
      );
      assert.throws(
        () => main.loadGitDiff(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === GIT_PANEL_NO_PANEL_MESSAGE,
      );
      assert.equal(main.shell.snapshot.accessible.git.open, beforeOpen);

      main.openGit();
      const beforeBad = main.shell.openGitPanel?.statusStdout ?? "";

      assert.throws(
        () => main.loadGitDiff("/abs/path"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === GIT_PANEL_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.loadGitDiff("../outside"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "OUT_OF_SCOPE" &&
          error.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );

      assert.equal(main.shell.openGitPanel?.statusStdout, beforeBad);
      assert.equal(main.shell.openGitPanel?.diffCommand, null);
      assert.equal(main.shell.openGitPanel?.diffStdout, "");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("caminho de erro: Git sem pasta aberta retorna INVALID_STATE", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });
    assert.throws(
      () => shell.openGit(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.throws(
      () => shell.loadGitDiff(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.git.open, false);
  });
});
