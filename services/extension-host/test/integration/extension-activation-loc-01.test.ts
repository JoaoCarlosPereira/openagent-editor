import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FROZEN_EXTENSION_API_VERSION } from "@openagent/extension-api";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { IsolatedExtensionHost } from "../../src/index.js";

const TEST_EXTENSION_MANIFEST = {
  name: "openagent-test-extension",
  publisher: "openagent",
  version: "1.0.0",
  displayName: "OpenAgent Test Extension",
  description: "Fixture determinística para ativação isolada (LOC-01).",
  main: "./extension.js",
  activationEvents: ["onCommand:openagent.test.sayHello"],
  contributes: {
    commands: [
      { command: "openagent.test.sayHello", title: "OpenAgent Test: Say Hello" },
    ],
  },
};

const TEST_EXTENSION_SOURCE = `'use strict';

let activations = 0;
let deactivations = 0;
let activeContext = null;
let activeApi = null;

function activate(context, api) {
  activations += 1;
  activeContext = context;
  activeApi = api;
  // Prova de isolamento: mutação de globalThis no worker não pode vazar para o host.
  globalThis.__extHostLeakProbe = "set-inside-isolated-worker";
  context.subscriptions.push(
    api.commands.registerCommand("openagent.test.sayHello", (name) => {
      return "hello " + (name || "world") + " (activation #" + activations + ")";
    }),
  );
  return { activated: true, activation: activations };
}

function deactivate() {
  deactivations += 1;
}

module.exports = {
  activate,
  deactivate,
  __internal: {
    get activations() { return activations; },
    get deactivations() { return deactivations; },
    getContext: () => activeContext,
    getApi: () => activeApi,
  },
};
`;

interface TestWorkspace {
  root: string;
  workspaceRoot: string;
  extensionsDirectory: string;
  extensionDirectory: string;
  outsideExtensionDirectory: string;
  symlinkExtensionPath: string;
  cleanup: () => void;
}

function makeTestWorkspace(): TestWorkspace {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-ext-host-"));
  const workspaceRoot = path.join(root, "workspace");
  const extensionsDirectory = path.join(root, "extensions");
  const outside = path.join(root, "outside");
  const extensionDirectory = path.join(extensionsDirectory, "openagent-test-extension");
  const outsideExtensionDirectory = path.join(outside, "outside-extension");

  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(extensionDirectory, { recursive: true });
  mkdirSync(outsideExtensionDirectory, { recursive: true });

  writeFileSync(
    path.join(extensionDirectory, "package.json"),
    JSON.stringify(TEST_EXTENSION_MANIFEST, null, 2),
    "utf8",
  );
  writeFileSync(path.join(extensionDirectory, "extension.js"), TEST_EXTENSION_SOURCE, "utf8");

  // Extensão idêntica fora do escopo (alvo de OUT_OF_SCOPE).
  writeFileSync(
    path.join(outsideExtensionDirectory, "package.json"),
    JSON.stringify(TEST_EXTENSION_MANIFEST, null, 2),
    "utf8",
  );
  writeFileSync(path.join(outsideExtensionDirectory, "extension.js"), TEST_EXTENSION_SOURCE, "utf8");

  // Symlink dentro do escopo apontando para fora (alvo de OUT_OF_SCOPE via realpath).
  const symlinkExtensionPath = path.join(extensionsDirectory, "evil-link");
  symlinkSync(outsideExtensionDirectory, symlinkExtensionPath, "dir");

  const cleanup = () => {
    rmSync(root, { recursive: true, force: true });
  };

  return {
    root,
    workspaceRoot,
    extensionsDirectory,
    extensionDirectory,
    outsideExtensionDirectory,
    symlinkExtensionPath,
    cleanup,
  };
}

async function assertProtocolErrorCode(
  action: Promise<unknown> | (() => unknown),
  expectedCode: string,
): Promise<ProtocolError> {
  let caught: unknown;
  try {
    if (typeof action === "function") {
      await action();
    } else {
      await action;
    }
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ProtocolError, `esperado ProtocolError, recebido: ${String(caught)}`);
  const error = caught as ProtocolError;
  assert.equal(error.code, expectedCode);
  return error;
}

test("[LOC-01] extensão compatível com a API do editor ativa e executa em worker isolado", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  const registration = host.registerExtensionFromDirectory(ws.extensionDirectory);
  assert.equal(registration.id, "openagent.openagent-test-extension");
  assert.equal(registration.state, "unloaded");
  assert.deepEqual(registration.registeredCommands, ["openagent.test.sayHello"]);

  const activation = await host.activateExtension(registration.id);
  assert.equal(activation.activated, true);
  assert.equal(activation.apiVersion, FROZEN_EXTENSION_API_VERSION);
  assert.equal(activation.apiVersion, "3.24.18");
  assert.equal(
    (activation.exports as { activated?: boolean } | undefined)?.activated,
    true,
  );
  assert.equal(host.getExtension(registration.id)?.state, "active");

  const result = await host.executeCommand("openagent.test.sayHello", "OpenAgent");
  assert.equal(result, "hello OpenAgent (activation #1)");

  // Isolamento: a mutação de globalThis feita pela extensão no worker não vaza para o host.
  assert.equal(
    (globalThis as typeof globalThis & Record<string, unknown>).__extHostLeakProbe,
    undefined,
  );

  const pong = await host.ping();
  assert.equal(pong.pong, true);
});

test("[LOC-01] ciclo de vida: desativar descarta comandos e permite reativação", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  const id = host.registerExtensionFromDirectory(ws.extensionDirectory).id;
  await host.activateExtension(id);
  assert.equal(await host.executeCommand("openagent.test.sayHello"), "hello world (activation #1)");

  const deactivation = await host.deactivateExtension(id);
  assert.equal(deactivation.deactivated, true);
  assert.equal(host.getExtension(id)?.state, "deactivated");

  await assertProtocolErrorCode(
    host.executeCommand("openagent.test.sayHello"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Reativação: estado recomeça e o comando volta a responder.
  await host.activateExtension(id);
  assert.equal(host.getExtension(id)?.state, "active");
  assert.equal(await host.executeCommand("openagent.test.sayHello"), "hello world (activation #2)");
});

test("[LOC-01] OUT_OF_SCOPE: extensão fora do extensionsDirectory (traversal) é negada sem efeito colateral", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  const traversalPath = path.join(ws.extensionsDirectory, "..", "outside", "outside-extension");
  await assertProtocolErrorCode(
    () => host.registerExtensionFromDirectory(traversalPath),
    PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
  );
  assert.equal(host.listExtensions().length, 0);
});

test("[LOC-01] OUT_OF_SCOPE: symlink dentro do escopo que aponta para fora é negado sem efeito colateral", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  await assertProtocolErrorCode(
    () => host.registerExtensionFromDirectory("evil-link"),
    PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
  );
  assert.equal(host.listExtensions().length, 0);
});

test("[LOC-01] INVALID_STATE sem efeito colateral: manifesto inválido, id desconhecido, ativação duplicada e desativação de inativa", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  // Variante com manifesto inválido (publisher ausente).
  const badManifestDirectory = path.join(ws.extensionsDirectory, "bad-manifest");
  mkdirSync(badManifestDirectory, { recursive: true });
  writeFileSync(
    path.join(badManifestDirectory, "package.json"),
    JSON.stringify({ name: "bad", version: "0.0.1", main: "./extension.js" }, null, 2),
    "utf8",
  );
  writeFileSync(path.join(badManifestDirectory, "extension.js"), TEST_EXTENSION_SOURCE, "utf8");

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  // Manifesto inválido: negado antes de qualquer efeito no worker.
  await assertProtocolErrorCode(
    () => host.registerExtensionFromDirectory(badManifestDirectory),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.equal(host.getExtension("bad.bad"), undefined);

  const id = host.registerExtensionFromDirectory(ws.extensionDirectory).id;

  // Ativação de id não registrado.
  await assertProtocolErrorCode(
    host.activateExtension("nobody.unknown"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.equal(host.getExtension(id)?.state, "unloaded");

  // Dupla ativação.
  await host.activateExtension(id);
  await assertProtocolErrorCode(
    host.activateExtension(id),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.equal(host.getExtension(id)?.state, "active");

  // Comando desconhecido no worker.
  await assertProtocolErrorCode(
    host.executeCommand("openagent.test.unknown"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Desativação de extensão já desativada.
  await host.deactivateExtension(id);
  await assertProtocolErrorCode(
    host.deactivateExtension(id),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Desativação de id não registrado.
  await assertProtocolErrorCode(
    host.deactivateExtension("nobody.unknown"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
});

test("[LOC-01] falha na ativação não persiste registro ativo e mantém o worker responsivo", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const brokenDirectory = path.join(ws.extensionsDirectory, "broken-extension");
  mkdirSync(brokenDirectory, { recursive: true });
  writeFileSync(
    path.join(brokenDirectory, "package.json"),
    JSON.stringify({
      name: "broken-extension",
      publisher: "openagent",
      version: "1.0.0",
      main: "./broken.js",
    }),
    "utf8",
  );
  writeFileSync(path.join(brokenDirectory, "broken.js"), "export default {", "utf8");

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });
  t.after(() => host.terminate());

  const id = host.registerExtensionFromDirectory(brokenDirectory).id;
  const activationError = await assertProtocolErrorCode(
    host.activateExtension(id),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.ok(activationError.message.length > 0);
  assert.equal(host.getExtension(id)?.state, "failed");
  assert.equal(host.getExtension(id)?.lastError, activationError.message);

  // A falha da extensão não deve encerrar o worker nem registrar comandos parcialmente.
  assert.deepEqual(await host.ping(), { pong: true });
  await assertProtocolErrorCode(
    host.executeCommand("openagent.test.sayHello"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
});

test("[LOC-01] encerramento do host: depois de terminate, chamadas são recusadas com INVALID_STATE", async (t) => {
  const ws = makeTestWorkspace();
  t.after(ws.cleanup);

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: ws.workspaceRoot,
    extensionsDirectory: ws.extensionsDirectory,
  });

  const id = host.registerExtensionFromDirectory(ws.extensionDirectory).id;
  await host.activateExtension(id);

  await host.terminate();
  assert.equal(host.isTerminated, true);

  await assertProtocolErrorCode(host.ping(), PROTOCOL_ERROR_CODES.INVALID_STATE);
  await assertProtocolErrorCode(host.activateExtension(id), PROTOCOL_ERROR_CODES.INVALID_STATE);
  await assertProtocolErrorCode(
    host.executeCommand("openagent.test.sayHello"),
    PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // terminate() idempotente.
  await host.terminate();
});
