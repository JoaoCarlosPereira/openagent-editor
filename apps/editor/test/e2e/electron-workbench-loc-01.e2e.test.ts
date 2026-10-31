import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ProtocolError } from "@openagent/protocol";

import {
  ELECTRON_MAIN_INVALID_PLATFORM_MESSAGE,
  ElectronMainController,
  OPENAGENT_ICON_RELATIVE_PATH,
  OPENAGENT_PRODUCT_NAME,
} from "../../src/main/electron-main.js";
import {
  WORKBENCH_CAPABILITY_SLOTS,
  WORKBENCH_FOLDER_INVALID_MESSAGE,
  WORKBENCH_FOLDER_REQUIRED_MESSAGE,
  WorkbenchShellController,
} from "../../src/workbench/workbench-shell.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("LOC-01 e2e — apps/editor Electron com nome e ícone OpenAgent", () => {
  it("lança main com nome OpenAgent e ícone media/icon.svg em linux/win32/darwin", () => {
    const main = new ElectronMainController();

    for (const platform of ["linux", "win32", "darwin"] as const) {
      const launched = main.launch({ platform, repoRoot: REPO_ROOT });
      assert.equal(launched.app.name, OPENAGENT_PRODUCT_NAME);
      assert.equal(launched.identity.productName, OPENAGENT_PRODUCT_NAME);
      assert.equal(launched.identity.iconRelativePath, OPENAGENT_ICON_RELATIVE_PATH);
      assert.equal(launched.browserWindow.title, "OpenAgent Editor");
      assert.equal(launched.browserWindow.icon, path.join(REPO_ROOT, OPENAGENT_ICON_RELATIVE_PATH));
      assert.equal(existsSync(launched.identity.iconPath), true);
      assert.match(launched.browserWindow.icon, /media[/\\]icon\.svg$/);
      assert.equal(launched.browserWindow.webPreferences.nodeIntegration, false);
      assert.equal(launched.browserWindow.webPreferences.contextIsolation, true);
      assert.equal(launched.daemon.connected, false);
      assert.equal(launched.daemon.toolsAllowedInRenderer, false);
      assert.equal(launched.platform, platform);
    }
  });

  it("abre pasta e oferece edição, terminal, Git, debug e extension-host com branding OpenAgent", () => {
    const main = new ElectronMainController();
    const launched = main.launch({ platform: "linux", repoRoot: REPO_ROOT });
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });

    const opened = shell.openFolder({
      platform: "linux",
      folderPath: REPO_ROOT,
      repoRoot: REPO_ROOT,
    });

    assert.equal(opened.identity.productName, OPENAGENT_PRODUCT_NAME);
    assert.equal(opened.identity.iconRelativePath, OPENAGENT_ICON_RELATIVE_PATH);
    assert.equal(opened.folderPath, path.resolve(REPO_ROOT));
    assert.match(opened.view.html, /data-testid="workbench-shell"/);
    assert.match(opened.view.html, /data-testid="workbench-product-name"/);
    assert.match(opened.view.html, new RegExp(`>${OPENAGENT_PRODUCT_NAME}<`));
    assert.match(opened.view.html, /data-testid="workbench-product-icon"/);
    assert.match(opened.view.html, /media\/icon\.svg/);
    assert.match(opened.view.html, new RegExp(path.basename(REPO_ROOT)));

    for (const slot of WORKBENCH_CAPABILITY_SLOTS) {
      assert.match(opened.view.html, new RegExp(`data-testid="workbench-slot-${slot}"`));
      assert.match(opened.view.html, new RegExp(`data-capability="${slot}"`));
    }
    assert.deepEqual([...opened.view.accessible.capabilitySlots], [
      "editor",
      "terminal",
      "git",
      "debug",
      "extension-host",
    ]);
    assert.equal(opened.view.accessible.productName, launched.identity.productName);
    assert.equal(shell.snapshot.accessible.focusOrder[0], "workbench-product-name");
    assert.equal(opened.view.accessible.toolsAllowedInRenderer, false);
    assert.match(opened.view.html, /data-tools-allowed-in-renderer="false"/);
    assert.match(opened.view.html, /data-testid="workbench-renderer-tools"/);
  });

  it("caminho de erro: plataforma inválida retorna INVALID_STATE sem efeito colateral", () => {
    const main = new ElectronMainController();
    assert.equal(main.current, null);

    assert.throws(
      () => main.launch({ platform: "amiga", repoRoot: REPO_ROOT }),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === ELECTRON_MAIN_INVALID_PLATFORM_MESSAGE,
    );
    assert.equal(main.current, null);
  });

  it("caminho de erro: pasta vazia ou inexistente retorna INVALID_STATE sem abrir workbench", () => {
    const shell = new WorkbenchShellController();
    shell.bootstrap({ platform: "linux", repoRoot: REPO_ROOT });
    assert.equal(shell.snapshot.accessible.folderPath, null);

    assert.throws(
      () =>
        shell.openFolder({
          platform: "linux",
          folderPath: "   ",
          repoRoot: REPO_ROOT,
        }),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_FOLDER_REQUIRED_MESSAGE,
    );

    assert.throws(
      () =>
        shell.openFolder({
          platform: "linux",
          folderPath: path.join(REPO_ROOT, "pasta-inexistente-loc-01"),
          repoRoot: REPO_ROOT,
        }),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKBENCH_FOLDER_INVALID_MESSAGE,
    );

    assert.equal(shell.snapshot.accessible.folderPath, null);
    assert.match(shell.snapshot.html, /Nenhuma pasta aberta/);
  });
});
