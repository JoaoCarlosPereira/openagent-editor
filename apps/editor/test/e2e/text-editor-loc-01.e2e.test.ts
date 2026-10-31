import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  TEXT_EDITOR_CONTENT_REQUIRED_MESSAGE,
  TEXT_EDITOR_NO_DOCUMENT_MESSAGE,
  TEXT_EDITOR_NOT_A_FILE_MESSAGE,
  TEXT_EDITOR_PATH_REQUIRED_MESSAGE,
  WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function createFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-text-editor-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
  writeFileSync(path.join(root, "src", "main.ts"), "console.log(1);\n", "utf8");
  return root;
}

describe("LOC-01 e2e — Editor de texto: abrir, editar e salvar", () => {
  it("main abre arquivo, edita buffer e salva conteúdo observável no disco", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      main.openFolder(fixture);

      const opened = main.openTextFile("README.md");
      assert.equal(opened.document.relativePath, "README.md");
      assert.equal(opened.document.content, "# fixture\n");
      assert.equal(opened.document.dirty, false);
      assert.equal(opened.view.accessible.productName, OPENAGENT_PRODUCT_NAME);
      assert.match(opened.view.html, /data-testid="workbench-slot-editor"/);
      assert.match(opened.view.html, /data-document-open="true"/);
      assert.match(opened.view.html, /data-testid="text-editor-content"/);
      assert.match(opened.view.html, /# fixture/);
      assert.equal(opened.view.accessible.textEditor.open, true);
      assert.equal(opened.view.accessible.textEditor.relativePath, "README.md");
      assert.equal(opened.view.accessible.textEditor.dirty, false);

      const edited = main.editTextDocument("# edited\n");
      assert.equal(edited.document.content, "# edited\n");
      assert.equal(edited.document.dirty, true);
      assert.match(edited.view.html, /data-dirty="true"/);
      assert.match(edited.view.html, /# edited/);
      assert.equal(readFileSync(path.join(fixture, "README.md"), "utf8"), "# fixture\n");

      const saved = main.saveTextDocument();
      assert.equal(saved.document.dirty, false);
      assert.match(saved.view.html, /data-dirty="false"/);
      assert.equal(readFileSync(path.join(fixture, "README.md"), "utf8"), "# edited\n");

      const nested = main.openTextFile("src/main.ts");
      assert.equal(nested.document.relativePath, "src/main.ts");
      assert.equal(nested.document.content, "console.log(1);\n");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: path inválido, fora do escopo e estado inválido sem efeito colateral", () => {
    const fixture = createFixtureWorkspace();
    try {
      const main = new ElectronMainController();
      assert.throws(
        () => main.openTextFile("README.md"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE,
      );

      main.launch({ platform: "linux", repoRoot: REPO_ROOT });
      assert.match(main.shell.snapshot.html, /Abra um arquivo para editar/);
      assert.equal(main.shell.snapshot.accessible.textEditor.open, false);

      assert.throws(
        () => main.openTextFile("README.md"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE,
      );

      main.openFolder(fixture);
      const beforeOpen = main.shell.snapshot.accessible.textEditor.open;

      assert.throws(
        () => main.openTextFile("   "),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_PATH_REQUIRED_MESSAGE,
      );
      assert.throws(
        () => main.openTextFile("../outside.txt"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "OUT_OF_SCOPE" &&
          error.message === OUT_OF_SCOPE_PATH_LOG_MESSAGE,
      );
      assert.throws(
        () => main.openTextFile("src"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_NOT_A_FILE_MESSAGE,
      );
      assert.throws(
        () => main.openTextFile("missing.txt"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_NOT_A_FILE_MESSAGE,
      );

      assert.equal(main.shell.snapshot.accessible.textEditor.open, beforeOpen);
      assert.equal(readFileSync(path.join(fixture, "README.md"), "utf8"), "# fixture\n");

      assert.throws(
        () => main.editTextDocument("x"),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_NO_DOCUMENT_MESSAGE,
      );
      assert.throws(
        () => main.saveTextDocument(),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_NO_DOCUMENT_MESSAGE,
      );

      main.openTextFile("README.md");
      assert.throws(
        () => main.editTextDocument(null),
        (error: unknown) =>
          error instanceof ProtocolError &&
          error.code === "INVALID_STATE" &&
          error.message === TEXT_EDITOR_CONTENT_REQUIRED_MESSAGE,
      );
      assert.equal(main.shell.openDocument?.content, "# fixture\n");
      assert.equal(main.shell.openDocument?.dirty, false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("caminho de erro: editar/salvar sem pasta aberta retorna INVALID_STATE", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });
    assert.throws(
      () => shell.openTextFile("a.ts"),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.throws(
      () => shell.saveTextDocument(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE,
    );
    assert.equal(shell.snapshot.accessible.textEditor.open, false);
  });
});
