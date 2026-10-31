const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("editor", {
  state: () => ipcRenderer.invoke("editor:action", "state"),
  folder: () => ipcRenderer.invoke("editor:action", "folder"),
  expand: (path) => ipcRenderer.invoke("editor:action", "expand", path),
  open: (path) => ipcRenderer.invoke("editor:action", "open", path),
  edit: (content) => ipcRenderer.invoke("editor:action", "edit", content),
  save: () => ipcRenderer.invoke("editor:action", "save"),
  extensionRequest: (operation, ...args) => ipcRenderer.invoke("editor:action", "extension-request", { operation, args }),
  onCloseRequest: (callback) => ipcRenderer.on("editor:prepare-close", () => callback()),
  onCloseCancelled: (callback) => ipcRenderer.on("editor:close-cancelled", () => callback()),
  closeReady: (ok) => ipcRenderer.send("editor:close-ready", ok),
});
