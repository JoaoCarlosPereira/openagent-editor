import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { ElectronMainController } from "../src/main/electron-main.js";
import { createEditorBridge } from "./bridge.js";
import { createCloseCoordinator } from "./close-coordinator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(path.join(here, "index.html")).href;
const controller = new ElectronMainController();
let window: BrowserWindow | null = null;

function confirmDiscard(): boolean {
  if (!controller.shell.openDocument?.dirty || !window) return true;
  return dialog.showMessageBoxSync(window, {
    type: "warning",
    buttons: ["Cancelar", "Descartar"],
    defaultId: 0,
    cancelId: 0,
    message: "Descartar alterações não salvas?",
  }) === 1;
}

async function start() {
  await app.whenReady();
  app.setName("OpenAgent Editor");
  const config = controller.launch({ platform: process.platform });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window = new BrowserWindow({
    ...config.browserWindow,
    width: 1100,
    height: 750,
    webPreferences: {
      ...config.browserWindow.webPreferences,
      preload: path.join(here, "preload.cjs"),
    },
  });
  const current = window;
  current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  current.webContents.on("will-navigate", (event, url) => {
    if (url !== page) event.preventDefault();
  });
  const closing = createCloseCoordinator({
    requestRenderer: () => current.webContents.send("editor:prepare-close"),
    confirmDiscard,
    closeWindow: () => current.close(),
    resumeRenderer: () => current.webContents.send("editor:close-cancelled"),
  });
  current.on("close", (event) => {
    if (!closing.request()) event.preventDefault();
  });
  const closeReady = (event: Electron.IpcMainEvent, ok: unknown) => {
    if (event.sender === current.webContents && event.senderFrame === current.webContents.mainFrame &&
        event.senderFrame.url === page && typeof ok === "boolean") closing.ready(ok);
  };
  ipcMain.on("editor:close-ready", closeReady);
  const bridge = createEditorBridge({
    controller,
    sender: current.webContents,
    frame: () => current.webContents.isDestroyed() ? null : current.webContents.mainFrame,
    page,
    confirmDiscard,
    chooseFolder: async () => {
      const result = await dialog.showOpenDialog(current, { properties: ["openDirectory"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  });
  current.on("closed", () => {
    window = null;
    bridge.close();
    ipcMain.removeHandler("editor:action");
    ipcMain.removeListener("editor:close-ready", closeReady);
  });
  ipcMain.handle("editor:action", (event, action: unknown, value: unknown) =>
    bridge.dispatch(event, action, value));
  await current.loadFile(path.join(here, "index.html"));
}

app.on("window-all-closed", () => app.quit());
start().catch((error: unknown) => {
  console.error("Falha ao iniciar editor:", error);
  app.exit(1);
});
