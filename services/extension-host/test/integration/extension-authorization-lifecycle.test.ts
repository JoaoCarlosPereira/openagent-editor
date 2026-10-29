import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import type { Worker } from "node:worker_threads";
import { IsolatedExtensionHost } from "../../src/index.js";

for (const operation of ["openTextDocument", "applyTextEdits"] as const) {
  for (const ending of ["disable", "replace", "terminate"] as const) {
    test(`${operation}: autorização pendente não despacha após ${ending}`, async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-auth-lifecycle-"));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const ext = path.join(root, "extension");
      fs.mkdirSync(ext);
      fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({
        publisher: "pub", name: "auth", version: "1.0.0", main: "./index.js",
      }));
      fs.writeFileSync(path.join(ext, "index.js"), `
        exports.activate = (ctx, api) => {
          ctx.subscriptions.push(api.commands.registerCommand("auth.run", () =>
            api.workspace.${operation}("file:///test"${operation === "applyTextEdits" ? ', 1, [{start: 0, end: 1, text: "x"}]' : ""})));
        };
      `);
      let entered!: () => void;
      const authorizationEntered = new Promise<void>((resolve) => { entered = resolve; });
      let release!: (allowed: boolean) => void;
      const authorization = new Promise<boolean>((resolve) => { release = resolve; });
      let calls = 0;
      const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root }, {
        authorizeEditorRequest: () => { entered(); return authorization; },
        editorRequest: () => { calls++; return {}; },
      });
      t.after(() => host.terminate());
      const id = host.registerExtensionFromDirectory(ext).id;
      await host.activateExtension(id);
      const command = host.executeCommand("auth.run").catch(() => undefined);
      await authorizationEntered;
      if (ending === "terminate") {
        await host.terminate();
      } else {
        await host.disableExtension(id);
        if (ending === "replace") {
          await host.enableExtension(id);
          await host.activateExtension(id);
        }
      }
      release(true);
      await command;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls, 0);
    });
  }
}

test("autorização normal permite dispatch", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-auth-normal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ext = path.join(root, "extension");
  fs.mkdirSync(ext);
  fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({
    publisher: "pub", name: "auth", version: "1.0.0", main: "./index.js",
  }));
  fs.writeFileSync(path.join(ext, "index.js"), `
    exports.activate = (ctx, api) => ctx.subscriptions.push(
      api.commands.registerCommand("auth.run", () => api.workspace.openTextDocument("file:///test")));
  `);
  let calls = 0;
  const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root }, {
    authorizeEditorRequest: async () => true,
    editorRequest: () => { calls++; return { uri: "file:///test", version: 1, text: "" }; },
  });
  t.after(() => host.terminate());
  const id = host.registerExtensionFromDirectory(ext).id;
  await host.activateExtension(id);
  await host.executeCommand("auth.run");
  assert.equal(calls, 1);
});

for (const operation of ["openTextDocument", "applyTextEdits"] as const) {
  for (const dispatched of [false, true]) {
    test(`${operation}: saída espontânea ${dispatched ? "preserva operação despachada" : "impede dispatch tardio"}`, async (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "extension-worker-exit-"));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const ext = path.join(root, "extension");
      fs.mkdirSync(ext);
      fs.writeFileSync(path.join(ext, "package.json"), JSON.stringify({
        publisher: "pub", name: "exit", version: "1.0.0", main: "./index.js",
      }));
      fs.writeFileSync(path.join(ext, "index.js"), `
        exports.activate = (ctx, api) => {
          ctx.subscriptions.push(api.commands.registerCommand("exit.run", () => {
            const result = api.workspace.${operation}("file:///test"${operation === "applyTextEdits" ? ', 1, [{start: 0, end: 1, text: "x"}]' : ""});
            setTimeout(() => process.exit(0), 50);
            return result;
          }));
        };
      `);
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let calls = 0;
      let effects = 0;
      const host = await IsolatedExtensionHost.spawn({ workspaceRoot: root, extensionsDirectory: root }, {
        authorizeEditorRequest: async () => {
          if (!dispatched) { entered(); await gate; }
          return true;
        },
        editorRequest: async () => {
          calls++;
          if (dispatched) { entered(); await gate; }
          effects++;
          return {};
        },
      });
      t.after(() => host.terminate());
      const id = host.registerExtensionFromDirectory(ext).id;
      await host.activateExtension(id);
      const worker = (host as unknown as { extensionWorkers: Map<string, Worker> }).extensionWorkers.get(id);
      assert.ok(worker);
      const exited = once(worker, "exit");
      const command = host.executeCommand("exit.run");
      const rejected = assert.rejects(command, { code: "CANCELLED" });
      await started;
      await exited;
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls, dispatched ? 1 : 0);
      assert.equal(effects, dispatched ? 1 : 0);
      await rejected;
    });
  }
}
