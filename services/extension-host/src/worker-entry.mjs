import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const FROZEN_EXTENSION_API_VERSION = "3.24.18";

/** @type {import('./types.js').ExtensionHostConfig | null} */
let currentConfig = null;

/** @type {Map<string, { module: any, context: any, subscriptions: any[], commands: string[] }>} */
const activeExtensions = new Map();

/** @type {Map<string, { handler: Function, extensionId: string }>} */
const commandRegistry = new Map();

/** @type {Map<string, string[]>} */
const outputChannels = new Map();

/** @param {import('./types.js').ExtensionWorkerResponse} message */
function post(message) {
  parentPort?.postMessage(message);
}

function makeMemento(store) {
  const map = new Map(Object.entries(store || {}));
  return {
    get(key, defaultValue) {
      return map.has(key) ? map.get(key) : defaultValue;
    },
    async update(key, value) {
      if (value === undefined) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
    },
    keys() {
      return Array.from(map.keys());
    },
  };
}

function createExtensionApi(extensionId, extensionPath, subscriptions) {
  const commandsApi = {
    registerCommand(command, callback, thisArg) {
      const bound = typeof thisArg !== "undefined" ? callback.bind(thisArg) : callback;
      commandRegistry.set(command, { handler: bound, extensionId });
      const disposable = {
        dispose() {
          const current = commandRegistry.get(command);
          if (current && current.extensionId === extensionId) {
            commandRegistry.delete(command);
          }
        },
      };
      subscriptions.push(disposable);
      post({
        kind: "event",
        eventType: "commandRegistered",
        payload: { extensionId, command },
      });
      return disposable;
    },
    async executeCommand(command, ...args) {
      const registered = commandRegistry.get(command);
      if (!registered) {
        throw new Error(`Comando '${command}' não encontrado.`);
      }
      return registered.handler(...args);
    },
    async getCommands() {
      return Array.from(commandRegistry.keys());
    },
  };

  const windowApi = {
    async showInformationMessage(message, ...items) {
      post({
        kind: "event",
        eventType: "messageShown",
        payload: { level: "info", extensionId, message, items },
      });
      return items[0];
    },
    async showWarningMessage(message, ...items) {
      post({
        kind: "event",
        eventType: "messageShown",
        payload: { level: "warning", extensionId, message, items },
      });
      return items[0];
    },
    async showErrorMessage(message, ...items) {
      post({
        kind: "event",
        eventType: "messageShown",
        payload: { level: "error", extensionId, message, items },
      });
      return items[0];
    },
    createOutputChannel(name) {
      if (!outputChannels.has(name)) {
        outputChannels.set(name, []);
      }
      const buffer = outputChannels.get(name);
      const channel = {
        name,
        append(val) {
          buffer.push(String(val));
          post({
            kind: "event",
            eventType: "outputAppended",
            payload: { name, chunk: String(val) },
          });
        },
        appendLine(val) {
          this.append(String(val) + "\n");
        },
        clear() {
          buffer.length = 0;
        },
        show() {},
        hide() {},
        getContent() {
          return buffer.join("");
        },
        dispose() {
          outputChannels.delete(name);
        },
      };
      subscriptions.push(channel);
      return channel;
    },
  };

  const workspaceApi = {
    get rootPath() {
      return currentConfig?.workspaceRoot;
    },
    get name() {
      return currentConfig?.workspaceRoot ? currentConfig.workspaceRoot.split("/").pop() : undefined;
    },
    getConfiguration(section) {
      const configStore = new Map();
      return {
        get(key, defaultValue) {
          const fullKey = section ? `${section}.${key}` : key;
          return configStore.has(fullKey) ? configStore.get(fullKey) : defaultValue;
        },
        has(key) {
          const fullKey = section ? `${section}.${key}` : key;
          return configStore.has(fullKey);
        },
        async update(key, value) {
          const fullKey = section ? `${section}.${key}` : key;
          configStore.set(fullKey, value);
        },
      };
    },
  };

  return {
    version: FROZEN_EXTENSION_API_VERSION,
    commands: commandsApi,
    window: windowApi,
    workspace: workspaceApi,
  };
}

parentPort?.on("message", async (message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.kind === "ping") {
    post({ kind: "result", requestId: message.requestId, output: { pong: true } });
    return;
  }

  if (message.kind === "init") {
    currentConfig = message.config;
    post({ kind: "result", requestId: message.requestId, output: { initialized: true } });
    return;
  }

  if (message.kind === "activate") {
    const { requestId, extensionId, mainAbsolutePath, extensionPath } = message;
    if (activeExtensions.has(extensionId)) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: `Extensão '${extensionId}' já está ativa.`,
      });
      return;
    }

    try {
      const subscriptions = [];
      const globalState = makeMemento({});
      const workspaceState = makeMemento({});
      const api = createExtensionApi(extensionId, extensionPath, subscriptions);

      const context = {
        extensionId,
        extensionPath,
        globalState,
        workspaceState,
        subscriptions,
        extensionUri: pathToFileURL(extensionPath),
      };

      const fileUrl = pathToFileURL(mainAbsolutePath).href;
      const mod = await import(fileUrl);

      let exportsResult = undefined;
      if (typeof mod.activate === "function") {
        exportsResult = await mod.activate(context, api);
      }

      activeExtensions.set(extensionId, {
        module: mod,
        context,
        subscriptions,
        commands: [],
      });

      post({
        kind: "result",
        requestId,
        output: {
          extensionId,
          activated: true,
          apiVersion: FROZEN_EXTENSION_API_VERSION,
          exports: exportsResult,
        },
      });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (message.kind === "executeCommand") {
    const { requestId, command, args } = message;
    const registered = commandRegistry.get(command);
    if (!registered) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: `Comando '${command}' não encontrado no worker do extension host.`,
      });
      return;
    }
    try {
      const output = await registered.handler(...(args || []));
      post({ kind: "result", requestId, output });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (message.kind === "deactivate") {
    const { requestId, extensionId } = message;
    const active = activeExtensions.get(extensionId);
    if (!active) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: `Extensão '${extensionId}' não está ativa.`,
      });
      return;
    }

    try {
      if (typeof active.module.deactivate === "function") {
        await active.module.deactivate();
      }

      for (const sub of active.subscriptions) {
        try {
          if (typeof sub?.dispose === "function") {
            sub.dispose();
          }
        } catch {
          // ignora falha em dispose individual
        }
      }

      for (const [cmd, reg] of Array.from(commandRegistry.entries())) {
        if (reg.extensionId === extensionId) {
          commandRegistry.delete(cmd);
        }
      }

      activeExtensions.delete(extensionId);
      post({
        kind: "result",
        requestId,
        output: { extensionId, deactivated: true },
      });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
});
