import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProtocolError } from "@openagent/protocol";
import { IsolatedExtensionHost } from "../../src/index.js";

const markerPath = (root: string, id: string) =>
  path.join(root, `.disabled-${createHash("sha256").update(id).digest("hex")}`);

test("habilitação persiste e controla o ciclo de vida sem ativação automática", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-enable-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `exports.activate = (ctx, api) => { ctx.subscriptions.push(api.commands.registerCommand("sample.command", () => "ok")); };`);
  const config = { workspaceRoot: root, extensionsDirectory: root };
  const host = await IsolatedExtensionHost.spawn(config);
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  assert.equal(await host.executeCommand("sample.command"), "ok");
  await host.disableExtension(id);
  assert.equal(host.isExtensionEnabled(id), false);
  await assert.rejects(host.activateExtension(id), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
  await assert.rejects(host.executeCommand("sample.command"));
  await host.terminate();
  const restarted = await IsolatedExtensionHost.spawn(config);
  t.after(() => restarted.terminate());
  restarted.registerExtensionFromDirectory(ext);
  assert.equal(restarted.isExtensionEnabled(id), false);
  await restarted.enableExtension(id);
  assert.equal(restarted.getExtension(id)?.state, "unloaded");
  await assert.rejects(restarted.executeCommand("sample.command"));
  await restarted.activateExtension(id);
  assert.equal(await restarted.executeCommand("sample.command"), "ok");
});

test("transições concorrentes e falhas não confirmam preferência alterada", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-enable-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `exports.activate = () => {}; exports.deactivate = async () => { await new Promise(r => setTimeout(r, 100)); };`);
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await assert.rejects(host.disableExtension("missing"), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_STATE");
  await host.activateExtension(id);
  const pending = host.disableExtension(id);
  await assert.rejects(host.enableExtension(id), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
  await assert.rejects(host.activateExtension(id), (error: unknown) => error instanceof ProtocolError && error.code === "CONFLICT");
  await pending;
  await host.enableExtension(id);
  const marker = markerPath(root, id);
  fs.mkdirSync(marker);
  await assert.rejects(host.enableExtension(id));
  assert.equal(host.isExtensionEnabled(id), false);
  await assert.rejects(host.disableExtension(id));
});

test("falha de desativação não grava a preferência", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-disable-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `exports.activate = () => {}; exports.deactivate = () => { throw new Error("failure"); };`);
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  await assert.rejects(host.disableExtension(id));
  assert.equal(host.isExtensionEnabled(id), true);
  assert.equal(host.getExtension(id)?.state, "failed");
});

test("falha de persistência após desativação exige reativação explícita", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-disable-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), "exports.activate = () => {};");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  const marker = markerPath(root, id);
  fs.mkdirSync(marker);
  await assert.rejects(host.disableExtension(id), (error: unknown) =>
    error instanceof ProtocolError && error.code === "INVALID_STATE" && /ativação explícita/.test(error.message));
  assert.equal(host.getExtension(id)?.state, "deactivated");
  fs.rmdirSync(marker);
  assert.equal(host.isExtensionEnabled(id), true);
  await host.activateExtension(id);
  assert.equal(host.getExtension(id)?.state, "active");
});

test("hosts recusam desabilitação enquanto outro host executa a extensão", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-enable-hosts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `exports.activate = (ctx, api) => { ctx.subscriptions.push(api.commands.registerCommand("sample.command", () => "ok")); };`);
  const config = { workspaceRoot: root, extensionsDirectory: root };
  const first = await IsolatedExtensionHost.spawn(config);
  const second = await IsolatedExtensionHost.spawn(config);
  t.after(() => Promise.all([first.terminate(), second.terminate()]));
  const id = first.registerExtensionFromDirectory(ext).id;
  second.registerExtensionFromDirectory(ext);
  await second.activateExtension(id);
  await assert.rejects(first.disableExtension(id), (error: unknown) =>
    error instanceof ProtocolError && error.code === "CONFLICT");
  assert.equal(second.isExtensionEnabled(id), true);
  assert.equal(await second.executeCommand("sample.command"), "ok");
  await second.deactivateExtension(id);
  await assert.rejects(first.disableExtension(id), (error: unknown) =>
    error instanceof ProtocolError && error.code === "CONFLICT");
  await second.disableExtension(id);
  assert.equal(second.isExtensionEnabled(id), false);
  await assert.rejects(second.activateExtension(id), (error: unknown) =>
    error instanceof ProtocolError && error.code === "INVALID_STATE");
  await first.enableExtension(id);
  await second.activateExtension(id);
  assert.equal(await second.executeCommand("sample.command"), "ok");
});

test("desabilitar encerra timers e permite reativação em worker novo", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-disable-timer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  const output = path.join(root, "ticks");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "timer", version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `
    const fs = require("node:fs");
    exports.activate = () => { fs.appendFileSync(${JSON.stringify(output)}, "a"); setInterval(() => fs.appendFileSync(${JSON.stringify(output)}, "t"), 10); };
    exports.deactivate = () => {};
  `);
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(fs.readFileSync(output, "utf8"), /t/);
  await host.disableExtension(id);
  const stopped = fs.readFileSync(output, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(output, "utf8"), stopped);
  await host.enableExtension(id);
  await host.activateExtension(id);
  assert.equal(fs.readFileSync(output, "utf8"), `${stopped}a`);
});

test("identificador longo ativa e preserva preferência entre hosts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-long-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "sample");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "p", name: "x".repeat(190), version: "1.0.0", main: "./index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), "exports.activate = () => {};");
  const config = { workspaceRoot: root, extensionsDirectory: root };
  const host = await IsolatedExtensionHost.spawn(config);
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  await host.disableExtension(id);
  const restarted = await IsolatedExtensionHost.spawn(config);
  t.after(() => restarted.terminate());
  restarted.registerExtensionFromDirectory(ext);
  assert.equal(restarted.isExtensionEnabled(id), false);
  await assert.rejects(restarted.activateExtension(id));
  await restarted.enableExtension(id);
  await restarted.activateExtension(id);
});
