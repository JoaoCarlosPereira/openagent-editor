import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { ProtocolError } from "@openagent/protocol";

import { ExtensionEditorController } from "../../../../apps/editor/src/workbench/extension-editor.js";
import { IsolatedExtensionHost } from "../../src/index.js";

test("extensão modifica buffer e aplica marcação ao texto", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "extension-editor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const extension = path.join(root, "extensions", "example");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(extension, { recursive: true });
  const file = path.join(workspace, "sample.txt");
  writeFileSync(file, "hello");
  writeFileSync(path.join(extension, "package.json"), JSON.stringify({
    publisher: "example", name: "editor", version: "1.0.0", main: "./index.js",
  }));
  writeFileSync(path.join(extension, "index.js"), `
    exports.activate = (context, api) => {
      context.subscriptions.push(api.commands.registerCommand("example.edit", async (uri) => {
        const doc = await api.workspace.openTextDocument(uri);
        await api.workspace.applyTextEdits(uri, doc.version, [{start: 0, end: 5, text: "world"}]);
        await api.workspace.setDecorations(uri, {id: "highlight", backgroundColor: "yellow"}, [{start: 0, end: 5}]);
      }));
    };
  `);
  const editor = new ExtensionEditorController(workspace);
  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: workspace,
    extensionsDirectory: path.dirname(extension),
  }, {
    authorizeEditorRequest: () => true,
    editorRequest: (request) => editor.handleRequest(request),
  });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(extension).id;
  await host.activateExtension(id);
  await host.executeCommand("example.edit", pathToFileURL(file).href);
  assert.equal(editor.snapshot?.text, "world");
  assert.equal(editor.snapshot?.version, 2);
  assert.equal(editor.snapshot?.dirty, true);
  assert.match(editor.snapshot?.html ?? "", /<span data-decoration="highlight" style="background-color:yellow">world<\/span>/);
});

test("edições vazias e ambíguas preservam estado e decorações", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "extension-editor-edits-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "sample.txt");
  writeFileSync(file, "hello");
  const uri = pathToFileURL(file).href;
  const editor = new ExtensionEditorController(root);
  editor.handleRequest({ operation: "openTextDocument", args: [uri] });
  editor.handleRequest({ operation: "setDecorations", args: [uri, { id: "highlight", backgroundColor: "yellow" }, [{ start: 0, end: 5 }]] });
  const before = editor.snapshot;

  assert.equal(editor.handleRequest({ operation: "applyTextEdits", args: [uri, 1, []] }), true);
  assert.deepEqual(editor.snapshot, before);
  assert.throws(
    () => editor.handleRequest({ operation: "applyTextEdits", args: [uri, 1, [
      { start: 1, end: 1, text: "a" }, { start: 1, end: 1, text: "b" },
    ]] }),
    (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE",
  );
  assert.deepEqual(editor.snapshot, before);
});
