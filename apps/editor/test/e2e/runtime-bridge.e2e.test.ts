import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ElectronMainController } from "../../src/main/electron-main.js";
import { createEditorBridge } from "../../runtime/bridge.js";

test("ponte autoriza somente o frame principal e preserva o workspace", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-bridge-"));
  const outside = mkdtempSync(path.join(tmpdir(), "openagent-outside-"));
  try {
    writeFileSync(path.join(root, "a.txt"), "original");
    writeFileSync(path.join(outside, "secret"), "secret");
    symlinkSync(path.join(outside, "secret"), path.join(root, "escape"));
    const controller = new ElectronMainController();
    controller.launch({ platform: process.platform });
    const sender = {};
    const frame = { url: "file:///editor/index.html" };
    const event = { sender, senderFrame: frame };
    let discard = true;
    const bridge = createEditorBridge({
      controller, sender, frame: () => frame, page: frame.url,
      confirmDiscard: () => discard, chooseFolder: async () => root,
    });
    await assert.rejects(bridge.dispatch({ sender: {}, senderFrame: frame }, "folder"), /não autorizada/);
    await assert.rejects(bridge.dispatch({ sender, senderFrame: { url: frame.url } }, "folder"), /não autorizada/);
    assert.equal((await bridge.dispatch(event, "folder")).folder, root);
    assert.equal((await bridge.dispatch(event, "open", "a.txt")).document?.content, "original");
    await assert.rejects(bridge.dispatch(event, "open", "../secret"));
    await assert.rejects(bridge.dispatch(event, "open", "escape"));
    await assert.rejects(bridge.dispatch(event, "tool.invoke"));
    const edited = await bridge.dispatch(event, "edit", { folder: root, path: "a.txt", version: 2, content: "novo" });
    assert.equal(edited.document?.dirty, true);
    discard = false;
    assert.equal((await bridge.dispatch(event, "open", "a.txt")).document?.content, "novo");
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "original");
    assert.equal((await bridge.dispatch(event, "save")).document?.dirty, false);
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "novo");
    await bridge.dispatch(event, "edit", { folder: root, path: "a.txt", version: 2, content: "buffer local" });
    writeFileSync(path.join(root, "a.txt"), "mudança externa");
    await assert.rejects(bridge.dispatch(event, "save"), /alterado fora/);
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "mudança externa");
    assert.equal(controller.shell.openDocument?.content, "buffer local");
    frame.url = "https://malicious.example/";
    await assert.rejects(bridge.dispatch(event, "save"), /não autorizada/);
    bridge.close();
    await assert.rejects(bridge.dispatch(event, "state"), /não autorizada/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("diálogo pendente é serializado e cancelado ao encerrar", async () => {
  const controller = new ElectronMainController();
  controller.launch({ platform: process.platform });
  const sender = {};
  const frame = { url: "file:///editor/index.html" };
  const event = { sender, senderFrame: frame };
  let resolveFolder!: (value: string | null) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const bridge = createEditorBridge({
    controller, sender, frame: () => frame, page: frame.url,
    confirmDiscard: () => true,
    chooseFolder: () => { started(); return new Promise((resolve) => { resolveFolder = resolve; }); },
  });
  const opening = bridge.dispatch(event, "folder");
  await ready;
  const pending = bridge.dispatch(event, "state");
  bridge.close();
  resolveFolder(null);
  await assert.rejects(opening, /encerrada/);
  await assert.rejects(pending, /não autorizada/);
});

test("falha de listagem e cancelamento preservam documento e raiz anterior", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-old-"));
  const next = mkdtempSync(path.join(tmpdir(), "openagent-new-"));
  const originalReaddir = fs.readdirSync;
  try {
    writeFileSync(path.join(root, "a.txt"), "original");
    writeFileSync(path.join(next, "a.txt"), "original");
    const controller = new ElectronMainController();
    controller.launch({ platform: process.platform });
    const sender = {};
    const frame = { url: "file:///editor/index.html" };
    const event = { sender, senderFrame: frame };
    let selected: string | null = root;
    let discard = true;
    const bridge = createEditorBridge({
      controller, sender, frame: () => frame, page: frame.url,
      confirmDiscard: () => discard, chooseFolder: async () => selected,
    });
    await bridge.dispatch(event, "folder");
    await bridge.dispatch(event, "open", "a.txt");
    await bridge.dispatch(event, "edit", { folder: root, path: "a.txt", version: 2, content: "editado" });
    const previous = await bridge.dispatch(event, "state");
    const snapshot = controller.shell.snapshot;
    selected = null;
    assert.deepEqual(await bridge.dispatch(event, "folder"), previous);
    discard = false;
    selected = next;
    assert.deepEqual(await bridge.dispatch(event, "folder"), previous);
    discard = true;
    fs.readdirSync = ((directory: fs.PathLike, ...args: unknown[]) => {
      if (directory === next) throw new Error("listagem recusada");
      return Reflect.apply(originalReaddir, fs, [directory, ...args]);
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();
    await assert.rejects(bridge.dispatch(event, "folder"), /listagem recusada/);
    assert.strictEqual(controller.shell.snapshot, snapshot);
    assert.deepEqual(await bridge.dispatch(event, "state"), previous);
    await bridge.dispatch(event, "save");
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "editado");
    assert.equal(readFileSync(path.join(next, "a.txt"), "utf8"), "original");
  } finally {
    fs.readdirSync = originalReaddir;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
    rmSync(next, { recursive: true, force: true });
  }
});

test("falha na reconstrução da árvore não registra expansão parcial", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-expand-"));
  const originalReaddir = fs.readdirSync;
  try {
    mkdirSync(path.join(root, "dir"));
    const controller = new ElectronMainController();
    controller.launch({ platform: process.platform });
    controller.openFolder(root);
    const previous = controller.shell.snapshot;
    fs.readdirSync = ((directory: fs.PathLike, ...args: unknown[]) => {
      if (directory === root) throw new Error("reconstrução recusada");
      return Reflect.apply(originalReaddir, fs, [directory, ...args]);
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();
    assert.throws(() => controller.shell.expandDirectory("dir"), /reconstrução recusada/);
    assert.strictEqual(controller.shell.snapshot, previous);
    fs.readdirSync = originalReaddir;
    syncBuiltinESMExports();
    controller.shell.setDaemonConnected(true);
    assert.deepEqual(controller.shell.snapshot.accessible.fileTree.expandedDirectories, []);
  } finally {
    fs.readdirSync = originalReaddir;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
