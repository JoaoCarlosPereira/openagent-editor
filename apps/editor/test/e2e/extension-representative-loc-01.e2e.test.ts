import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FROZEN_EXTENSION_API_VERSION } from "@openagent/extension-api";
import { IsolatedExtensionHost, createVsixArchive } from "@openagent/extension-host";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { ElectronMainController, OPENAGENT_ICON_RELATIVE_PATH } from "../../src/main/electron-main.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FIXTURE_DIR = path.join(REPO_ROOT, "services/extension-host/fixtures/openagent-representative");
const EXTENSION_ID = "openagent.openagent-representative";

function readTree(directory: string, prefix = ""): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, readTree(path.join(directory, entry.name), relative));
    else files[relative] = readFileSync(path.join(directory, entry.name));
  }
  return files;
}

function buildVsix(mutate?: (files: Record<string, Buffer>) => void): Buffer {
  const files = readTree(FIXTURE_DIR);
  mutate?.(files);
  const entries: Record<string, string | Buffer> = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "extension.vsixmanifest": '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0"/>',
  };
  for (const [name, content] of Object.entries(files)) entries[`extension/${name}`] = content;
  return createVsixArchive(entries);
}

function makeEnvironment(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-ext-representative-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const extensionsDirectory = path.join(root, "extensions");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(extensionsDirectory, { recursive: true });
  const file = path.join(workspace, "readme.md");
  writeFileSync(file, "hello workbench\n", "utf8");
  const vsixPath = path.join(root, "openagent-representative-1.0.0.vsix");
  return { root, workspace, extensionsDirectory, file, vsixPath };
}

test("[LOC-01] extensao representativa OpenAgent instalada via VSIX fica ativa no workbench", async (t) => {
  const env = makeEnvironment(t);
  writeFileSync(env.vsixPath, buildVsix());

  const controller = new ElectronMainController();
  controller.launch({ platform: process.platform, repoRoot: REPO_ROOT });
  controller.openFolder(env.workspace);

  const messages: unknown[] = [];
  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensionsDirectory,
  }, {
    authorizeEditorRequest: (request) => request.extensionId === EXTENSION_ID,
    editorRequest: (request) => controller.handleExtensionEditorRequest(request),
  });
  t.after(() => host.terminate());
  host.addEventListener((event) => {
    if (event.eventType === "messageShown") messages.push(event.payload);
  });

  const installed = await host.installVsix(env.vsixPath);
  assert.equal(installed.id, EXTENSION_ID);
  assert.equal(installed.state, "unloaded");
  assert.equal(installed.manifest.displayName, "OpenAgent Representative Extension");
  assert.equal(installed.manifest.icon, "media/icon.svg");
  assert.deepEqual(installed.registeredCommands, [
    "openagent.representative.brand",
    "openagent.representative.status",
  ]);

  const iconPath = path.join(installed.extensionPath, installed.manifest.icon as string);
  assert.equal(existsSync(iconPath), true);
  assert.deepEqual(readFileSync(iconPath), readFileSync(path.join(REPO_ROOT, OPENAGENT_ICON_RELATIVE_PATH)));

  const activation = await host.activateExtension(EXTENSION_ID);
  assert.equal(activation.activated, true);
  assert.equal(activation.apiVersion, FROZEN_EXTENSION_API_VERSION);
  assert.deepEqual(activation.exports, { activated: true, apiVersion: "3.24.18" });
  assert.equal(host.getExtension(EXTENSION_ID)?.state, "active");

  assert.deepEqual(await host.executeCommand("openagent.representative.status"), {
    active: true,
    apiVersion: "3.24.18",
    extensionId: EXTENSION_ID,
  });
  assert.deepEqual(messages, [{
    level: "info",
    extensionId: EXTENSION_ID,
    message: "OpenAgent representative extension active",
    items: [],
  }]);

  const uri = pathToFileURL(env.file).href;
  assert.deepEqual(await host.executeCommand("openagent.representative.brand", uri), {
    branded: true,
    apiVersion: "3.24.18",
  });
  const snapshot = controller.extensionEditor?.snapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.text, "OpenAgent: hello workbench\n");
  assert.equal(snapshot.version, 2);
  assert.match(snapshot.html, /data-decoration="openagent-brand"/);

  assert.equal(host.getRegisteredHoverProviders().filter((p) => p.extensionId === EXTENSION_ID).length, 1);
  assert.deepEqual(await host.provideHover({ uri, text: snapshot.text }, { line: 0, character: 0 }, EXTENSION_ID), {
    contents: ["OpenAgent"],
  });

  await host.deactivateExtension(EXTENSION_ID);
  await assert.rejects(
    host.executeCommand("openagent.representative.status"),
    (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
});

test("[LOC-01] erro: VSIX com icone ausente e comando nao autorizado sao recusados sem efeito colateral", async (t) => {
  const env = makeEnvironment(t);
  const brokenVsix = path.join(env.root, "broken.vsix");
  writeFileSync(brokenVsix, buildVsix((files) => {
    delete files["media/icon.svg"];
  }));
  writeFileSync(env.vsixPath, buildVsix());

  const controller = new ElectronMainController();
  controller.launch({ platform: process.platform, repoRoot: REPO_ROOT });
  controller.openFolder(env.workspace);

  const requests: unknown[] = [];
  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: env.workspace,
    extensionsDirectory: env.extensionsDirectory,
  }, {
    authorizeEditorRequest: () => false,
    editorRequest: (request) => {
      requests.push(request);
      return controller.handleExtensionEditorRequest(request);
    },
  });
  t.after(() => host.terminate());

  await assert.rejects(
    host.installVsix(brokenVsix),
    (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );
  assert.deepEqual(host.listExtensions(), []);
  assert.deepEqual(readdirSync(env.extensionsDirectory), []);

  await assert.rejects(
    host.activateExtension(EXTENSION_ID),
    (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  await host.installVsix(env.vsixPath);
  await host.activateExtension(EXTENSION_ID);
  await assert.rejects(
    host.executeCommand("openagent.representative.brand", pathToFileURL(env.file).href),
    (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.PERMISSION_DENIED,
  );
  assert.deepEqual(requests, []);
  assert.equal(controller.extensionEditor?.snapshot, null);
  assert.equal(readFileSync(env.file, "utf8"), "hello workbench\n");
});
