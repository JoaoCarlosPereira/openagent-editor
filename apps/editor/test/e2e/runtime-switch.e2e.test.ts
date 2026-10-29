import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { ElectronMainController } from "../../src/main/electron-main.js";
import { createEditorBridge } from "../../runtime/bridge.js";

class Element {
  value = "";
  textContent = "";
  disabled = false;
  readOnly = false;
  inert = false;
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  addEventListener(name: string, fn: () => void) { this.listeners.set(name, fn); }
  replaceChildren() { this.children = []; }
  append(child: Element) { this.children.push(child); }
  click() { this.listeners.get("click")?.(); }
  input(value: string) { if (!this.readOnly && !this.disabled) { this.value = value; this.listeners.get("input")?.(); } }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("troca pendente não aplica texto de A a B e preserva cancelamento e erro", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "editor-switch-"));
  try {
    writeFileSync(path.join(root, "a.txt"), "A");
    writeFileSync(path.join(root, "b.txt"), "B");
    const controller = new ElectronMainController();
    controller.launch({ platform: process.platform });
    controller.openFolder(root);
    controller.openTextFile("a.txt");
    const sender = {};
    const frame = { url: "file:///editor/index.html" };
    const event = { sender, senderFrame: frame };
    let discard = false;
    const bridge = createEditorBridge({ controller, sender, frame: () => frame, page: frame.url,
      confirmDiscard: () => !controller.shell.openDocument?.dirty || discard, chooseFolder: async () => null });
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    const editor = {
      state: () => bridge.dispatch(event, "state"),
      edit: (value: unknown) => bridge.dispatch(event, "edit", value),
      save: () => bridge.dispatch(event, "save"),
      folder: () => bridge.dispatch(event, "folder"),
      expand: (value: string) => bridge.dispatch(event, "expand", value),
      open: async (value: string) => {
        if (value === "b.txt") { started(); await new Promise<void>((resolve) => { release = resolve; }); }
        return bridge.dispatch(event, "open", value);
      },
      onCloseRequest() {}, onCloseCancelled() {}, closeReady() {},
    };
    const elements = new Map(["folder", "save", "workspace", "files", "filename", "content", "error"].map((id) => [`#${id}`, new Element()]));
    const document = { querySelector: (id: string) => elements.get(id), createElement: () => new Element(), addEventListener() {} };
    vm.runInNewContext(readFileSync(new URL("../../runtime/renderer.js", import.meta.url), "utf8"), { document, window: { editor } });
    await tick();
    const content = elements.get("#content");
    const files = elements.get("#files");
    const save = elements.get("#save");
    const folder = elements.get("#folder");
    assert.ok(content); assert.ok(files); assert.ok(save); assert.ok(folder);
    const b = files.children.find((item) => item.children[0]?.textContent === "b.txt")?.children[0];
    assert.ok(b);
    b.click();
    await begun;
    assert.equal(content.readOnly, true, "a entrada deve ser bloqueada antes da troca");
    content.input("texto de A");
    release();
    await tick(); await tick();
    assert.equal(controller.shell.openDocument?.relativePath, "b.txt");
    assert.equal(content.value, "B");
    save.click();
    await tick(); await tick();
    assert.equal(readFileSync(path.join(root, "b.txt"), "utf8"), "B");
    assert.equal(readFileSync(path.join(root, "a.txt"), "utf8"), "A");
    await assert.rejects(bridge.dispatch(event, "edit", { folder: root, path: "a.txt", version: 0, content: "atrasado" }), /documento mudou/);
    assert.equal(controller.shell.openDocument?.content, "B");
    content.input("B alterado");
    await tick(); await tick();
    const a = files.children.find((item) => item.children[0]?.textContent === "a.txt")?.children[0];
    assert.ok(a);
    a.click();
    await tick(); await tick();
    assert.equal(controller.shell.openDocument?.relativePath, "b.txt");
    assert.equal(content.value, "B alterado");
    assert.equal(content.readOnly, false);
    save.click();
    await tick(); await tick();
    assert.equal(readFileSync(path.join(root, "b.txt"), "utf8"), "B alterado");
    folder.click();
    assert.equal(content.readOnly, true);
    await tick(); await tick();
    assert.equal(content.readOnly, false);
    assert.equal(content.value, "B alterado");
    assert.equal(controller.shell.openDocument?.relativePath, "b.txt");
    discard = true;
    await assert.rejects(bridge.dispatch(event, "open", "missing"));
    assert.equal(controller.shell.openDocument?.relativePath, "b.txt");
    const previous = (await bridge.dispatch(event, "state")).documentVersion;
    await bridge.dispatch(event, "open", "b.txt");
    await assert.rejects(bridge.dispatch(event, "edit", { folder: root, path: "b.txt", version: previous, content: "antigo" }), /documento mudou/);
    assert.equal(controller.shell.openDocument?.content, "B alterado");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
