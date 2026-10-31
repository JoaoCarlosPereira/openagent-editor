import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { IsolatedExtensionHost } from "@openagent/extension-host";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { ElectronMainController } from "../../src/main/electron-main.js";
import { createEditorBridge } from "../../runtime/bridge.js";

test("[LOC-01] fluxo integrado: extension-host em worker interage com editor, decorações e bridge", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "openagent-ext-editor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const workspace = path.join(root, "workspace");
  const extensionsDir = path.join(root, "extensions");
  const extensionDir = path.join(extensionsDir, "theme-extension");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(extensionDir, { recursive: true });

  const file = path.join(workspace, "code.ts");
  writeFileSync(file, "hello world;\nconst x = 10;\n", "utf8");

  writeFileSync(path.join(extensionDir, "package.json"), JSON.stringify({
    name: "theme-extension",
    publisher: "openagent",
    version: "1.0.0",
    main: "./index.js",
    activationEvents: ["onCommand:openagent.decorateDoc"],
    contributes: {
      commands: [{ command: "openagent.decorateDoc", title: "Decorate Document" }],
    },
  }, null, 2), "utf8");

  writeFileSync(path.join(extensionDir, "index.js"), `
    exports.activate = (context, api) => {
      context.subscriptions.push(api.commands.registerCommand("openagent.decorateDoc", async (fileUri) => {
        const doc = await api.workspace.openTextDocument(fileUri);
        await api.workspace.applyTextEdits(fileUri, doc.version, [
          { start: 0, end: 5, text: "OpenAgent" },
        ]);
        await api.workspace.setDecorations(
          fileUri,
          { id: "brand-highlight", backgroundColor: "#0055ff", outlineColor: "#ffffff" },
          [{ start: 0, end: 9 }],
        );
        return { version: 2, decorated: true };
      }));
    };
  `, "utf8");

  const controller = new ElectronMainController();
  controller.launch({ platform: process.platform });
  controller.openFolder(workspace);

  const sender = {};
  const frame = { url: "file:///editor/index.html" };
  const event = { sender, senderFrame: frame };
  const bridge = createEditorBridge({
    controller,
    sender,
    frame: () => frame,
    page: frame.url,
    confirmDiscard: () => true,
    chooseFolder: async () => workspace,
  });

  const host = await IsolatedExtensionHost.spawn({
    workspaceRoot: workspace,
    extensionsDirectory: extensionsDir,
  }, {
    authorizeEditorRequest: (req) => req.extensionId === "openagent.theme-extension",
    editorRequest: (req) => controller.handleExtensionEditorRequest(req),
  });
  t.after(() => host.terminate());

  const reg = host.registerExtensionFromDirectory(extensionDir);
  assert.equal(reg.id, "openagent.theme-extension");
  await host.activateExtension(reg.id);

  const uri = pathToFileURL(file).href;
  const commandResult = await host.executeCommand<{ version: number; decorated: true }>(
    "openagent.decorateDoc",
    uri,
  );
  assert.deepEqual(commandResult, { version: 2, decorated: true });

  const extSnapshot = controller.extensionEditor?.snapshot;
  assert.ok(extSnapshot, "Snapshot do editor de extensão deve existir.");
  assert.equal(extSnapshot.version, 2);
  assert.equal(extSnapshot.dirty, true);
  assert.ok(extSnapshot.text.startsWith("OpenAgent world;"));
  assert.match(
    extSnapshot.html,
    /<span data-decoration="brand-highlight" style="background-color:#0055ff;outline:1px solid #ffffff">OpenAgent<\/span>/,
  );

  const bridgeState = await bridge.dispatch(event, "state") as {
    folder: string;
    extensionDecorations: string | null;
  };
  assert.equal(bridgeState.folder, workspace);
  assert.equal(bridgeState.extensionDecorations, extSnapshot.html);

  // Ciclo de vida: desativação descarta comando
  await host.deactivateExtension(reg.id);
  await assert.rejects(
    host.executeCommand("openagent.decorateDoc", uri),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
  );

  // Segurança: recusa operação não autorizada sem efeito colateral
  const unauthorizedHost = await IsolatedExtensionHost.spawn({
    workspaceRoot: workspace,
    extensionsDirectory: extensionsDir,
  }, {
    authorizeEditorRequest: () => false,
    editorRequest: (req) => controller.handleExtensionEditorRequest(req),
  });
  t.after(() => unauthorizedHost.terminate());

  await unauthorizedHost.activateExtension(unauthorizedHost.registerExtensionFromDirectory(extensionDir).id);
  await assert.rejects(
    unauthorizedHost.executeCommand("openagent.decorateDoc", uri),
    (err: unknown) => err instanceof ProtocolError && err.code === PROTOCOL_ERROR_CODES.PERMISSION_DENIED,
  );
});
