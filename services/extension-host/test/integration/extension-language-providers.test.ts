import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { IsolatedExtensionHost } from "../../src/index.js";

interface TestEnv {
  root: string;
  workspace: string;
  extensions: string;
  cleanup: () => void;
}

function setupEnv(): TestEnv {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-ext-lang-"));
  const workspace = path.join(root, "workspace");
  const extensions = path.join(root, "extensions");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(extensions, { recursive: true });
  return {
    root,
    workspace,
    extensions,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createExtension(
  extensionsDir: string,
  name: string,
  code: string,
): string {
  const extDir = path.join(extensionsDir, name);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    path.join(extDir, "package.json"),
    JSON.stringify({
      name,
      publisher: "openagent",
      version: "1.0.0",
      main: "./index.js",
    }, null, 2),
    "utf8",
  );
  writeFileSync(path.join(extDir, "index.js"), code, "utf8");
  return extDir;
}

test("[LOC-01] extensão registra completion provider via api.languages e host recebe sugestões", async (t) => {
  const env = setupEnv();
  t.after(env.cleanup);

  const extDir = createExtension(
    env.extensions,
    "lang-completion",
    `
    exports.activate = (context, api) => {
      const disposable = api.languages.registerCompletionItemProvider("typescript", {
        async provideCompletionItems(doc, position) {
          return [
            { label: "hello", detail: "saudação", kind: 1 },
            { label: "world", detail: "planeta", kind: 2 },
          ];
        },
        async resolveCompletionItem(item) {
          return { ...item, documentation: { kind: "markdown", value: "Detalhes de " + item.label } };
        },
      }, ".");
      context.subscriptions.push(disposable);
    };
    `,
  );

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensions,
  });
  t.after(() => host.terminate());

  const reg = host.registerExtensionFromDirectory(extDir);
  await host.activateExtension(reg.id);

  const providers = host.getRegisteredCompletionProviders();
  assert.equal(providers.length, 1);
  const firstProv = providers[0];
  assert.ok(firstProv);
  assert.equal(firstProv.extensionId, reg.id);
  assert.deepEqual(firstProv.triggerCharacters, ["."]);

  const items = await host.provideCompletionItems<{ label: string; detail?: string; documentation?: unknown }>(
    "file:///workspace/src/app.ts",
    { line: 0, character: 3 },
  );
  assert.equal(items.length, 2);
  const item0 = items[0];
  const item1 = items[1];
  assert.ok(item0 && item1);
  assert.equal(item0.label, "hello");
  assert.equal(item0.detail, "saudação");
  assert.equal(item1.label, "world");

  // Resolução de completion item
  const resolved = await host.resolveCompletionItem<{ label: string; documentation?: { value: string } }>(
    item0,
    reg.id,
  );
  assert.equal(resolved.label, "hello");
  assert.equal(resolved.documentation?.value, "Detalhes de hello");
});

test("[LOC-01] extensão registra hover provider via api.languages e host recebe hover contents", async (t) => {
  const env = setupEnv();
  t.after(env.cleanup);

  const extDir = createExtension(
    env.extensions,
    "lang-hover",
    `
    exports.activate = (context, api) => {
      const disposable = api.languages.registerHoverProvider("*", {
        async provideHover(doc, position) {
          return {
            contents: { kind: "markdown", value: "Hover sobre " + position.line + ":" + position.character },
            range: {
              start: { line: position.line, character: 0 },
              end: { line: position.line, character: 10 },
            },
          };
        },
      });
      context.subscriptions.push(disposable);
    };
    `,
  );

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensions,
  });
  t.after(() => host.terminate());

  const reg = host.registerExtensionFromDirectory(extDir);
  await host.activateExtension(reg.id);

  assert.equal(host.getRegisteredHoverProviders().length, 1);

  const hover = await host.provideHover<{ contents: { value: string }; range: { start: { line: number } } }>(
    "file:///workspace/main.js",
    { line: 3, character: 5 },
  );
  assert.ok(hover);
  assert.equal(hover.contents.value, "Hover sobre 3:5");
  assert.equal(hover.range.start.line, 3);
});

test("[LOC-01] ciclo de vida: desativação da extensão remove os providers de linguagem e limpa worker", async (t) => {
  const env = setupEnv();
  t.after(env.cleanup);

  const extDir = createExtension(
    env.extensions,
    "lifecycle-lang",
    `
    exports.activate = (context, api) => {
      context.subscriptions.push(
        api.languages.registerCompletionItemProvider("typescript", {
          async provideCompletionItems() {
            return [{ label: "ephemeral" }];
          },
        }),
        api.languages.registerHoverProvider("typescript", {
          async provideHover() {
            return { contents: { kind: "markdown", value: "ephemeral hover" } };
          },
        }),
      );
    };
    `,
  );

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensions,
  });
  t.after(() => host.terminate());

  const reg = host.registerExtensionFromDirectory(extDir);
  await host.activateExtension(reg.id);

  assert.equal(host.getRegisteredCompletionProviders().length, 1);
  assert.equal(host.getRegisteredHoverProviders().length, 1);

  const beforeItems = await host.provideCompletionItems("file:///test.ts", { line: 0, character: 0 });
  assert.equal(beforeItems.length, 1);

  // Desativa extensão
  const deact = await host.deactivateExtension(reg.id);
  assert.equal(deact.deactivated, true);

  assert.equal(host.getRegisteredCompletionProviders().length, 0);
  assert.equal(host.getRegisteredHoverProviders().length, 0);

  // Invocação direcionada à extensão desativada lança INVALID_STATE
  await assert.rejects(
    host.provideCompletionItems("file:///test.ts", { line: 0, character: 0 }, undefined, reg.id),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  await assert.rejects(
    host.provideHover("file:///test.ts", { line: 0, character: 0 }, reg.id),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Invocação geral sem extensão ativa retorna vazio sem erro
  const afterItems = await host.provideCompletionItems("file:///test.ts", { line: 0, character: 0 });
  assert.equal(afterItems.length, 0);
  const afterHover = await host.provideHover("file:///test.ts", { line: 0, character: 0 });
  assert.equal(afterHover, undefined);
});

test("[LOC-01] isolamento: duas extensões registram providers independentes em workers distintos", async (t) => {
  const env = setupEnv();
  t.after(env.cleanup);

  const extADir = createExtension(
    env.extensions,
    "ext-ts",
    `
    exports.activate = (context, api) => {
      context.subscriptions.push(
        api.languages.registerCompletionItemProvider("typescript", {
          async provideCompletionItems() {
            return [{ label: "tsItem" }];
          },
        }),
      );
    };
    `,
  );

  const extBDir = createExtension(
    env.extensions,
    "ext-json",
    `
    exports.activate = (context, api) => {
      context.subscriptions.push(
        api.languages.registerCompletionItemProvider("json", {
          async provideCompletionItems() {
            return [{ label: "jsonItem" }];
          },
        }),
      );
    };
    `,
  );

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensions,
  });
  t.after(() => host.terminate());

  const regA = host.registerExtensionFromDirectory(extADir);
  const regB = host.registerExtensionFromDirectory(extBDir);

  await host.activateExtension(regA.id);
  await host.activateExtension(regB.id);

  assert.equal(host.getRegisteredCompletionProviders().length, 2);

  const tsItems = await host.provideCompletionItems<{ label: string }>("file:///test.ts", { line: 0, character: 0 });
  assert.equal(tsItems.length, 1);
  const firstTs = tsItems[0];
  assert.ok(firstTs);
  assert.equal(firstTs.label, "tsItem");

  const jsonItems = await host.provideCompletionItems<{ label: string }>("file:///test.json", { line: 0, character: 0 });
  assert.equal(jsonItems.length, 1);
  const firstJson = jsonItems[0];
  assert.ok(firstJson);
  assert.equal(firstJson.label, "jsonItem");

  // Desativar Ext A não afeta Ext B
  await host.deactivateExtension(regA.id);
  assert.equal(host.getRegisteredCompletionProviders().length, 1);

  const jsonItemsAfter = await host.provideCompletionItems<{ label: string }>("file:///test.json", { line: 0, character: 0 });
  assert.equal(jsonItemsAfter.length, 1);
});

test("[LOC-01] caminhos de erro: entradas inválidas e host encerrado retornam INVALID_STATE sem efeito colateral", async (t) => {
  const env = setupEnv();
  t.after(env.cleanup);

  const extDir = createExtension(
    env.extensions,
    "err-provider",
    `
    exports.activate = (context, api) => {
      context.subscriptions.push(
        api.languages.registerCompletionItemProvider("typescript", {
          async provideCompletionItems() { return [{ label: "ok" }]; },
        }),
      );
    };
    `,
  );

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensions,
  });
  t.after(() => host.terminate());

  const reg = host.registerExtensionFromDirectory(extDir);
  await host.activateExtension(reg.id);

  // Documento inválido
  await assert.rejects(
    host.provideCompletionItems("", { line: 0, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  await assert.rejects(
    host.provideHover("", { line: 0, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Posições inválidas
  await assert.rejects(
    host.provideCompletionItems("file:///test.ts", { line: -1, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  await assert.rejects(
    host.provideCompletionItems("file:///test.ts", { line: 0, character: 1.2 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  await assert.rejects(
    host.provideHover("file:///test.ts", { line: -2, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Item de resolução inválido
  await assert.rejects(
    host.resolveCompletionItem(null, reg.id),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Host encerrado
  await host.terminate();
  assert.equal(host.isTerminated, true);

  await assert.rejects(
    host.provideCompletionItems("file:///test.ts", { line: 0, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  await assert.rejects(
    host.provideHover("file:///test.ts", { line: 0, character: 0 }),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
});
