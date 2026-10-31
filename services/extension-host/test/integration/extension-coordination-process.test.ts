import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { IsolatedExtensionHost } from "../../src/index.js";

function request(child: ChildProcess, action: string): Promise<{ ok: boolean; value?: unknown; code?: string }> {
  return new Promise((resolve, reject) => {
    const onExit = () => reject(new Error("Processo encerrado antes da resposta"));
    child.once("exit", onExit);
    child.once("message", (message) => {
      child.off("exit", onExit);
      resolve(message as { ok: boolean; value?: unknown; code?: string });
    });
    child.send({ action });
  });
}

test("coordenação entre processos preserva execução, falhas e reinício", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-process-"));
  const ext = path.join(root, "extension");
  const other = path.join(root, "other");
  const ticks = path.join(root, "ticks");
  fs.mkdirSync(ext);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "sample", version: "1.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `
    const fs = require("node:fs");
    exports.activate = async (ctx, api) => {
      fs.writeFileSync(${JSON.stringify(path.join(root, "starting"))}, "yes");
      await new Promise(r => setTimeout(r, 250));
      setInterval(() => fs.appendFileSync(${JSON.stringify(ticks)}, "x"), 20);
      ctx.subscriptions.push(api.commands.registerCommand("sample.command", () => "ok"));
    };
  `);
  fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ publisher: "pub", name: "other", version: "1.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(other, "index.js"), `exports.activate = (ctx, api) => ctx.subscriptions.push(api.commands.registerCommand("other.command", () => "other"));`);
  const childFile = path.join(root, "host.mjs");
  const hostModule = new URL("../../src/index.ts", import.meta.url).href;
  fs.writeFileSync(childFile, `
    import { IsolatedExtensionHost } from ${JSON.stringify(hostModule)};
    const root = process.argv[2];
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
    const id = host.registerExtensionFromDirectory(root + "/extension").id;
    process.send({ ready: true });
    process.on("message", async ({ action }) => {
      try {
        const value = action === "activate" ? await host.activateExtension(id) :
          action === "command" ? await host.executeCommand("sample.command") :
          action === "disable" ? await host.disableExtension(id) :
          action === "enabled" ? host.isExtensionEnabled(id) : await host.terminate();
        process.send({ ok: true, value });
      } catch (error) { process.send({ ok: false, code: error.code }); }
    });
  `);
  const child = fork(childFile, [root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  await once(child, "message");
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  const otherId = host.registerExtensionFromDirectory(other).id;
  const activation = request(child, "activate");
  while (!fs.existsSync(path.join(root, "starting"))) await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(host.disableExtension(id), { code: "CONFLICT" });
  await assert.rejects(host.activateExtension(id), { code: "CONFLICT" });
  await host.activateExtension(otherId);
  assert.equal(await host.executeCommand("other.command"), "other");
  assert.equal((await activation).ok, true);
  assert.equal((await request(child, "command")).value, "ok");
  assert.equal(host.isExtensionEnabled(id), true);
  await new Promise((r) => setTimeout(r, 70));
  assert.ok(fs.readFileSync(ticks, "utf8").length > 0);
  assert.equal((await request(child, "disable")).ok, true);
  const stopped = fs.readFileSync(ticks, "utf8");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fs.readFileSync(ticks, "utf8"), stopped);
  assert.equal((await request(child, "command")).ok, false);
  assert.equal(host.isExtensionEnabled(id), false);
  assert.equal(await host.executeCommand("other.command"), "other");
  await assert.rejects(host.activateExtension(id), { code: "INVALID_STATE" });
  await host.enableExtension(id);
  assert.equal((await request(child, "activate")).ok, true);
  child.kill("SIGKILL");
  await once(child, "exit");
  await host.disableExtension(id);
  await host.terminate();
  const restarted = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  try {
    restarted.registerExtensionFromDirectory(ext);
    assert.equal(restarted.isExtensionEnabled(id), false);
    await assert.rejects(restarted.activateExtension(id), { code: "INVALID_STATE" });
    await restarted.enableExtension(id);
    await restarted.activateExtension(id);
    assert.equal(await restarted.executeCommand("sample.command"), "ok");
  } finally {
    await restarted.terminate();
  }
});

test("encerramento concorrente mantém lock até worker realmente parar", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-shutdown-"));
  const ext = path.join(root, "extension");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({ publisher: "pub", name: "race", version: "1.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(ext, "index.js"), `exports.activate = () => { setInterval(() => require("node:fs").appendFileSync(${JSON.stringify(path.join(root, "ticks"))}, "x"), 10); };`);
  const hostModule = new URL("../../src/index.ts", import.meta.url).href;
  const childFile = path.join(root, "host.mjs");
  fs.writeFileSync(childFile, `
    import { IsolatedExtensionHost } from ${JSON.stringify(hostModule)};
    const root = process.argv[2];
    const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
    const id = host.registerExtensionFromDirectory(root + "/extension").id;
    await host.activateExtension(id);
    const worker = host.extensionWorkers.get(id);
    const terminate = worker.terminate.bind(worker);
    let release;
    worker.terminate = () => new Promise(resolve => { release = () => resolve(terminate()); process.send({ event: "barrier" }); });
    process.send({ event: "ready" });
    process.on("message", ({ action }) => {
      if (action === "disable") void host.disableExtension(id).then(() => process.send({ event: "disable", ok: true }), error => process.send({ event: "disable", code: error.code }));
      if (action === "terminate") {
        const shutdown = Promise.all([host.terminate(), host.terminate()]);
        process.send({ event: "shutdown-started" });
        void shutdown.then(() => process.send({ event: "terminated" }));
      }
      if (action === "release") release();
    });
  `);
  const child = fork(childFile, [root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual((await once(child, "message"))[0], { event: "ready" });
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  child.send({ action: "disable" });
  assert.deepEqual((await once(child, "message"))[0], { event: "barrier" });
  child.send({ action: "terminate" });
  assert.deepEqual((await once(child, "message"))[0], { event: "shutdown-started" });
  await assert.rejects(host.disableExtension(id), { code: "CONFLICT" });
  assert.equal(host.isExtensionEnabled(id), true);
  const ticks = path.join(root, "ticks");
  const before = fs.readFileSync(ticks, "utf8").length;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(fs.readFileSync(ticks, "utf8").length > before);
  const events: string[] = [];
  const finished = new Promise<void>((resolve) => {
    child.on("message", (message: { event: string }) => {
      events.push(message.event);
      if (events.includes("terminated") && events.includes("disable")) resolve();
    });
  });
  child.send({ action: "release" });
  await finished;
  await host.disableExtension(id);
  assert.equal(host.isExtensionEnabled(id), false);
  const stopped = fs.readFileSync(ticks, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.readFileSync(ticks, "utf8"), stopped);
});

for (const mode of ["disable", "crash"] as const) {
  test(`subprocesso da extensão não continua após ${mode}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-descendant-"));
    const ext = path.join(root, "extension");
    const ticks = path.join(root, "ticks");
    const pidFile = path.join(root, "pid");
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({
      publisher: "pub", name: "descendant", version: "1.0.0", main: "index.js",
    }));
    fs.writeFileSync(path.join(ext, "index.js"), `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      exports.activate = () => {
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(`setInterval(() => require("node:fs").appendFileSync(${JSON.stringify(ticks)}, "x"), 10)`)}], { stdio: "ignore" });
        fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
      };
    `);
    const childFile = path.join(root, "host.mjs");
    const hostModule = new URL("../../src/index.ts", import.meta.url).href;
    fs.writeFileSync(childFile, `
      import { IsolatedExtensionHost } from ${JSON.stringify(hostModule)};
      const root = process.argv[2];
      const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root });
      const id = host.registerExtensionFromDirectory(root + "/extension").id;
      await host.activateExtension(id);
      process.send({ ready: true });
      process.on("message", async () => {
        try { await host.disableExtension(id); process.send({ ok: true }); }
        catch (error) { process.send({ ok: false, code: error.code }); }
      });
    `);
    const child = fork(childFile, [root], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
    t.after(async () => {
      if (fs.existsSync(pidFile)) {
        try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* Already exited. */ }
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    await once(child, "message");
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ticks) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(fs.existsSync(ticks), "subprocesso não iniciou");
    if (mode === "disable") {
      child.send({});
      assert.deepEqual((await once(child, "message"))[0], { ok: true });
    } else {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    const before = fs.readFileSync(ticks, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fs.readFileSync(ticks, "utf8"), before, "subprocesso continuou executando");
  });
}
