import { ElectronMainController } from "../src/main/electron-main.js";

export interface BridgeEvent {
  sender: unknown;
  senderFrame: unknown;
}

export interface BridgeOptions {
  controller: ElectronMainController;
  sender: object;
  frame: () => { url: string } | null;
  page: string;
  confirmDiscard: () => boolean;
  chooseFolder: () => Promise<string | null>;
}

export function createEditorBridge(options: BridgeOptions) {
  const { controller } = options;
  let documentVersion = 0;
  const state = () => ({
    entries: controller.shell.visibleEntries,
    document: controller.shell.openDocument,
    folder: controller.shell.snapshot.accessible.folderPath,
    documentVersion,
  });
  let closed = false;
  let pending = Promise.resolve();
  return {
    close() {
      closed = true;
      controller.closeDaemon();
    },
    dispatch(event: BridgeEvent, action: unknown, value?: unknown) {
      const run = async () => {
        const frame = options.frame();
        if (closed || !frame || event.sender !== options.sender ||
            event.senderFrame !== frame || frame.url !== options.page) {
          throw new Error("Origem IPC não autorizada.");
        }
        switch (action) {
          case "state": break;
          case "folder": {
            if (!options.confirmDiscard()) break;
            const folder = await options.chooseFolder();
            if (closed || options.frame() !== frame || frame.url !== options.page) {
              throw new Error("Janela encerrada ou origem IPC alterada.");
            }
            if (folder) {
              controller.openFolder(folder);
              documentVersion++;
            }
            break;
          }
          case "expand": controller.shell.expandDirectory(value); break;
          case "open":
            if (options.confirmDiscard()) {
              controller.openTextFile(value);
              documentVersion++;
            }
            break;
          case "edit": {
            if (!value || typeof value !== "object" ||
                !("folder" in value) || !("path" in value) || !("content" in value) || !("version" in value) ||
                value.version !== documentVersion ||
                value.folder !== controller.shell.snapshot.accessible.folderPath ||
                value.path !== controller.shell.openDocument?.relativePath) {
              throw new Error("O documento mudou antes da edição.");
            }
            controller.editTextDocument(value.content);
            break;
          }
          case "save": controller.saveTextDocument(); break;
          default: throw new Error("Operação de editor inválida.");
        }
        return state();
      };
      const result = pending.then(run);
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
