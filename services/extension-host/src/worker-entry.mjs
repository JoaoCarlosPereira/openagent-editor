
function wrapTextDocument(rawDoc) {
  if (!rawDoc || typeof rawDoc !== "object") {
    return {
      uri: "",
      version: 1,
      lineCount: 1,
      text() { return ""; },
    };
  }
  const textContent = typeof rawDoc.text === "function" ? rawDoc.text() : String(rawDoc.text || "");
  return {
    uri: rawDoc.uri || "",
    version: rawDoc.version || 1,
    lineCount: rawDoc.lineCount || textContent.split("\n").length,
    text() { return textContent; },
  };
}

function matchSingleSelector(selector, uri) {
  if (selector === "*") return true;
  if (typeof selector === "string") {
    const u = uri.toLowerCase();
    const sel = selector.toLowerCase();
    if (sel === "typescript" && (u.endsWith(".ts") || u.endsWith(".tsx"))) return true;
    if (sel === "javascript" && (u.endsWith(".js") || u.endsWith(".jsx") || u.endsWith(".mjs") || u.endsWith(".cjs"))) return true;
    if (sel === "json" && u.endsWith(".json")) return true;
    if (sel === "markdown" && (u.endsWith(".md") || u.endsWith(".markdown"))) return true;
    if (u.endsWith("." + sel)) return true;
    return u.includes(sel);
  }
  if (selector && typeof selector === "object") {
    if (selector.scheme) {
      const scheme = uri.split(":")[0];
      if (scheme !== selector.scheme) return false;
    }
    if (selector.language && selector.language !== "*") {
      if (!matchSingleSelector(selector.language, uri)) return false;
    }
    if (selector.filepath && !uri.includes(selector.filepath)) return false;
    if (selector.pattern) {
      try {
        if (!new RegExp(selector.pattern).test(uri)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  return false;
}

function matchesSelector(selector, uri) {
  if (typeof selector === "string") return matchSingleSelector(selector, uri);
  if (Array.isArray(selector)) return selector.some((s) => matchSingleSelector(s, uri));
  if (selector && typeof selector === "object") return matchSingleSelector(selector, uri);
  return false;
}
import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";

// Rastreamento de subprocessos criados pela extensão. Códigos CJS em
// require("node:child_process") recebem o módulo cacheado desta thread, então
// o patch cobre uma extensão inteira e segue confinada ao worker em que
// roda. Extensões ESM que fazem import direto do módulo recebem um
// namespace congelado e não são rastreadas (limitação declarada).
try {
  const { createRequire } = await import("node:module");
  const cp = createRequire(import.meta.url)("node:child_process");
  const spawnOriginal = cp.spawn.bind(cp);
  const rastrearFilho = (child) => {
    if (!child || typeof child.pid !== "number" || child.pid <= 0) {
      return child;
    }
    child.once("spawn", () => {
      parentPort?.postMessage({ kind: "childProc", eventType: "spawned", pid: child.pid });
    });
    child.once("exit", () => {
      parentPort?.postMessage({ kind: "childProc", eventType: "exited", pid: child.pid });
    });
    return child;
  };
  cp.spawn = function spawnRastreado(file, args, options) {
    return rastrearFilho(spawnOriginal(file, args, options));
  };
  cp.fork = function forkRastreado(entry, args, options) {
    const listaArgs = args ?? undefined;
    const optsArgs = options ?? undefined;
    return rastrearFilho(spawnOriginal(
      process.execPath,
      [entry, ...(Array.isArray(listaArgs) ? listaArgs : [])],
      { stdio: ["inherit", "inherit", "inherit", "ipc"], ...(optsArgs || {}) },
    ));
  };
} catch {
  // Sem o rastreamento o degradação é registrada no README; extensões
  // continuam funcionando.
}

const FROZEN_EXTENSION_API_VERSION = "3.24.18";

/** @type {import('./types.js').ExtensionHostConfig | null} */
let currentConfig = null;

/** @type {Map<string, { module: any, context: any, subscriptions: any[], commands: string[] }>} */
const activeExtensions = new Map();

/** @type {Map<string, { handler: Function, extensionId: string }>} */
const commandRegistry = new Map();

/** @type {Map<string, string[]>} */
const outputChannels = new Map();

/** @type {Map<string, { id: string, extensionId: string, selector: any, provider: any, triggerCharacters?: string[] }>} */
const completionProviderRegistry = new Map();

/** @type {Map<string, { id: string, extensionId: string, selector: any, provider: any }>} */
const hoverProviderRegistry = new Map();

let nextProviderId = 0;

let nextEditorRequestId = 0;
const pendingEditorRequests = new Map();

function requestEditor(extensionId, operation, args) {
  const requestId = `editor-${nextEditorRequestId++}`;
  return new Promise((resolve, reject) => {
    pendingEditorRequests.set(requestId, { resolve, reject });
    post({ kind: "editorRequest", requestId, extensionId, operation, args });
  });
}

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
    openTextDocument(uri) {
      return requestEditor(extensionId, "openTextDocument", [uri]);
    },
    applyTextEdits(uri, expectedVersion, edits) {
      return requestEditor(extensionId, "applyTextEdits", [uri, expectedVersion, edits]);
    },
    setDecorations(uri, decoration, ranges) {
      return requestEditor(extensionId, "setDecorations", [uri, decoration, ranges]);
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

  const languagesApi = {
    registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
      if (!selector || (typeof selector !== "string" && typeof selector !== "object")) {
        const error = new Error("Seletor de documento inválido.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (typeof selector === "string" && !selector.trim()) {
        const error = new Error("Seletor de documento não pode ser vazio.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (Array.isArray(selector) && selector.length === 0) {
        const error = new Error("Lista de seletores não pode ser vazia.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (!provider || typeof provider !== "object") {
        const error = new Error("Provider de completion inválido: objeto esperado.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (typeof provider.provideCompletionItems !== "function") {
        const error = new Error("Provider de completion deve implementar provideCompletionItems().");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (provider.resolveCompletionItem !== undefined && typeof provider.resolveCompletionItem !== "function") {
        const error = new Error("resolveCompletionItem deve ser função quando fornecido.");
        error.code = "INVALID_STATE";
        throw error;
      }

      const flatTriggers = triggerCharacters.flat();
      for (const char of flatTriggers) {
        if (typeof char !== "string") {
          const error = new Error("Caracteres de trigger devem ser strings.");
          error.code = "INVALID_STATE";
          throw error;
        }
      }

      const providerId = "comp-" + (nextProviderId++);
      completionProviderRegistry.set(providerId, {
        id: providerId,
        extensionId,
        selector,
        provider,
        triggerCharacters: flatTriggers.length ? flatTriggers : undefined,
      });

      const disposable = {
        dispose() {
          if (completionProviderRegistry.has(providerId)) {
            completionProviderRegistry.delete(providerId);
            post({
              kind: "event",
              eventType: "completionProviderUnregistered",
              payload: { extensionId, providerId },
            });
          }
        },
      };
      subscriptions.push(disposable);

      post({
        kind: "event",
        eventType: "completionProviderRegistered",
        payload: {
          extensionId,
          providerId,
          selector,
          triggerCharacters: flatTriggers.length ? flatTriggers : undefined,
        },
      });

      return disposable;
    },
    registerCompletionProvider(selector, provider, ...triggerCharacters) {
      return this.registerCompletionItemProvider(selector, provider, ...triggerCharacters);
    },
    registerHoverProvider(selector, provider) {
      if (!selector || (typeof selector !== "string" && typeof selector !== "object")) {
        const error = new Error("Seletor de documento inválido.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (typeof selector === "string" && !selector.trim()) {
        const error = new Error("Seletor de documento não pode ser vazio.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (Array.isArray(selector) && selector.length === 0) {
        const error = new Error("Lista de seletores não pode ser vazia.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (!provider || typeof provider !== "object") {
        const error = new Error("Provider de hover inválido: objeto esperado.");
        error.code = "INVALID_STATE";
        throw error;
      }
      if (typeof provider.provideHover !== "function") {
        const error = new Error("Provider de hover deve implementar provideHover().");
        error.code = "INVALID_STATE";
        throw error;
      }

      const providerId = "hover-" + (nextProviderId++);
      hoverProviderRegistry.set(providerId, {
        id: providerId,
        extensionId,
        selector,
        provider,
      });

      const disposable = {
        dispose() {
          if (hoverProviderRegistry.has(providerId)) {
            hoverProviderRegistry.delete(providerId);
            post({
              kind: "event",
              eventType: "hoverProviderUnregistered",
              payload: { extensionId, providerId },
            });
          }
        },
      };
      subscriptions.push(disposable);

      post({
        kind: "event",
        eventType: "hoverProviderRegistered",
        payload: {
          extensionId,
          providerId,
          selector,
        },
      });

      return disposable;
    },
  };

  return {
    version: FROZEN_EXTENSION_API_VERSION,
    commands: commandsApi,
    window: windowApi,
    workspace: workspaceApi,
    languages: languagesApi,
  };
}

parentPort?.on("message", async (message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.kind === "editorResponse") {
    const pending = pendingEditorRequests.get(message.requestId);
    if (!pending) return;
    pendingEditorRequests.delete(message.requestId);
    if (message.error) {
      const error = new Error(message.error.message);
      error.code = message.error.code;
      pending.reject(error);
    } else pending.resolve(message.output);
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
        code: err?.code || "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (message.kind === "provideCompletionItems") {
    const { requestId, extensionId, providerId, document: rawDoc, position, context } = message;
    try {
      const doc = wrapTextDocument(rawDoc);
      const providers = [];
      if (providerId) {
        const reg = completionProviderRegistry.get(providerId);
        if (reg) providers.push(reg);
      } else {
        for (const reg of completionProviderRegistry.values()) {
          if (extensionId === "*" || reg.extensionId === extensionId) {
            if (matchesSelector(reg.selector, doc.uri)) {
              providers.push(reg);
            }
          }
        }
      }

      const allItems = [];
      for (const reg of providers) {
        const res = await reg.provider.provideCompletionItems(doc, position, undefined, context);
        if (Array.isArray(res)) {
          allItems.push(...res);
        } else if (res && typeof res === "object" && Array.isArray(res.items)) {
          allItems.push(...res.items);
        }
      }

      post({ kind: "result", requestId, output: allItems });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: err?.code || "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (message.kind === "resolveCompletionItem") {
    const { requestId, extensionId, providerId, item } = message;
    try {
      let resolved = item;
      let reg = providerId ? completionProviderRegistry.get(providerId) : null;
      if (!reg) {
        for (const candidate of completionProviderRegistry.values()) {
          if ((!extensionId || extensionId === "*" || candidate.extensionId === extensionId) &&
              typeof candidate.provider.resolveCompletionItem === "function") {
            reg = candidate;
            break;
          }
        }
      }
      if (reg && typeof reg.provider.resolveCompletionItem === "function") {
        resolved = await reg.provider.resolveCompletionItem(item);
      }
      post({ kind: "result", requestId, output: resolved });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: err?.code || "INVALID_STATE",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (message.kind === "provideHover") {
    const { requestId, extensionId, providerId, document: rawDoc, position } = message;
    try {
      const doc = wrapTextDocument(rawDoc);
      const providers = [];
      if (providerId) {
        const reg = hoverProviderRegistry.get(providerId);
        if (reg) providers.push(reg);
      } else {
        for (const reg of hoverProviderRegistry.values()) {
          if (extensionId === "*" || reg.extensionId === extensionId) {
            if (matchesSelector(reg.selector, doc.uri)) {
              providers.push(reg);
            }
          }
        }
      }

      let hoverResult = undefined;
      for (const reg of providers) {
        const res = await reg.provider.provideHover(doc, position, undefined);
        if (res !== undefined && res !== null) {
          hoverResult = res;
          break;
        }
      }

      post({ kind: "result", requestId, output: hoverResult });
    } catch (err) {
      post({
        kind: "error",
        requestId,
        code: err?.code || "INVALID_STATE",
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
        code: err?.code || "INVALID_STATE",
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

      for (const [id, reg] of Array.from(completionProviderRegistry.entries())) {
        if (reg.extensionId === extensionId) {
          completionProviderRegistry.delete(id);
        }
      }

      for (const [id, reg] of Array.from(hoverProviderRegistry.entries())) {
        if (reg.extensionId === extensionId) {
          hoverProviderRegistry.delete(id);
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
