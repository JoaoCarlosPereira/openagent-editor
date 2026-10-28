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
  FILE_TREE_DIRECTORY_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  WORKBENCH_FOLDER_INVALID_MESSAGE,
  WORKBENCH_FOLDER_NOT_OPEN_MESSAGE,
  WORKBENCH_FOLDER_REQUIRED_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function createFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-file-tree-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
  writeFileSync(path.join(root, "src", "main.ts"), "console.log(1);\n", "utf8");
  return root;
}

describe("LOC-01 e2e — Abrir pasta e árvore de arquivos", () => {
  it("main abre pasta e mostra árvore com arquivos e diretórios observáveis", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      main.launch({ platform: "linux", repoRoot: REPO_ROOT });

      const opened = main.openFolder(fixture);

      assert.equal(opened.identity.productName, OPENAGENT_PRODUCT_NAME);
      assert.equal(opened.folderPath, path.resolve(fixture));
      assert.ok(opened.fileTreeEntries.some((e) => e.name === "README.md" && e.kind === "file"));
      assert.ok(opened.fileTreeEntries.some((e) => e.name === "src" && e.kind === "directory"));
      assert.match(opened.view.html, /data-testid="workbench-file-tree"/);
      assert.match(opened.view.html, /data-folder-open="true"/);
      assert.match(opened.view.html, /data-testid="file-tree-entry"/);
      assert.match(opened.view.html, /data-path="README\.md"/);
      assert.match(opened.view.html, /data-path="src"/);
      assert.match(opened.view.html, /data-kind="directory"/);
      assert.equal(opened.view.accessible.fileTree.folderPath, path.resolve(fixture));
      assert.ok(opened.view.accessible.fileTree.entryCount >= 2);

      const expanded = main.shell.expandDirectory("src");
      assert.match(expanded.html, /data-path="src\/main\.ts"/);
      assert.match(expanded.html, /data-expanded="true"/);
      assert.ok(expanded.accessible.fileTree.expandedDirectories.includes("src"));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: pasta inválida e path fora do escopo sem efeito colateral", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      assert.throws(
        () => main.openFolder(fixture),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );

      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      assert.equal(main.shell.snapshot.accessible.folderPath, null);
      assert.match(main.shell.snapshot.html, /data-testid="workbench-file-tree"/);
      assert.match(main.shell.snapshot.html, /Abra uma pasta para ver a árvore/);

      assert.throws(
        () => main.openFolder("   "),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === WORKBENCH_FOLDER_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.openFolder(path.join(fixture, "nao-existe")),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === WORKBENCH_FOLDER_INVALID_MESSAGE,
      );
      assert.equal(main.shell.snapshot.accessible.folderPath, null);
      assert.equal(main.shell.snapshot.accessible.fileTree.entryCount, 0);

      main.openFolder(fixture);
      const beforeExpand = main.shell.snapshot.accessible.fileTree.entryCount;

      assert.throws(
        () => main.shell.expandDirectory("../outside"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "OUT_OF_SCOPE" &&
          error.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );
      assert.throws(
        () => main.shell.expandDirectory(""),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === FILE_TREE_DIRECTORY_REQUIRED_MESSAGE,
      );

      assert.equal(main.shell.snapshot.accessible.fileTree.entryCount, beforeExpand);
      assert.deepEqual([...main.shell.snapshot.accessible.fileTree.expandedDirectories], []);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: expandir sem pasta aberta retorna INVALID_STATE", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });
    assert.throws(
      () => shell.expandDirectory("src"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.folderPath, null);
  });
});
