import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type {
  CommandEntry, CommandRegistration, CommandsNamespace, StatusBarItem,
  TextDocumentData, TextEditorDecorationType, WindowNamespace, WorkspaceFile, WorkspaceNamespace,
} from "./frozen-surface.js";
export type {
  CommandEntry, CommandRegistration, CommandsNamespace, StatusBarItem,
  TextDocumentData, TextEditorDecorationType, WindowNamespace, WorkspaceFile, WorkspaceNamespace,
};

export interface WorkspaceAdapter {
  files: readonly WorkspaceFile[];
  contents: Readonly<Record<string, string>>;
  configuration?: Record<string, unknown>;
  save?(uri: string, content: string): boolean | Promise<boolean>;
}

export interface WindowAdapter {
  chooseMessage?(kind: "information" | "warning" | "error", message: string, options: readonly unknown[]): unknown | Promise<unknown>;
  input?(options?: Record<string, unknown>): string | undefined | Promise<string | undefined>;
}

function invalid(message: string): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

export function createCommandsNamespace(): CommandsNamespace {
  const registry = new Map<string, CommandRegistration>();
  return {
    registerCommand(commandId, callback) {
      if (typeof commandId !== "string" || commandId.trim().length === 0) throw invalid("ID de comando inválido.");
      if (typeof callback !== "function") throw invalid("Callback de comando inválido.");
      if (registry.has(commandId)) throw invalid(`Comando '${commandId}' já registrado.`);
      const registration = { commandId, callback };
      registry.set(commandId, registration);
      return registration;
    },
    unregisterCommand(commandId) { registry.delete(commandId); },
    getRegisteredCommands() { return Array.from(registry.values(), ({ commandId, callback }) => ({ command: commandId, callback })); },
    async executeCommand<T>(commandId: string, ...args: unknown[]): Promise<T> {
      const entry = registry.get(commandId);
      if (!entry) throw invalid(`Comando '${commandId}' não encontrado.`);
      return entry.callback(...args) as T;
    },
  };
}

export function createWindowNamespace(adapter: WindowAdapter = {}): WindowNamespace {
  const statusBars = new Map<string, StatusBarItem>();
  const choose = (kind: "information" | "warning" | "error", message: string, options: unknown[]) =>
    adapter.chooseMessage ? adapter.chooseMessage(kind, message, options) : undefined;
  return {
    async showInformationMessage(message, ...options) { return choose("information", message, options); },
    async showWarningMessage(message, ...options) { return choose("warning", message, options); },
    async showErrorMessage(message, ...options) { return choose("error", message, options); },
    createStatusBarItem(id, alignment) {
      const existing = statusBars.get(id);
      if (existing) return existing;
      const item: StatusBarItem = { id, alignment, text: "" };
      statusBars.set(id, item);
      return item;
    },
    getStatusBarItems() { return Array.from(statusBars.values()); },
    async showInputBox(options) { return adapter.input ? adapter.input(options) : undefined; },
  };
}

export function createWorkspaceNamespace(
  workspaceRoot?: string,
  workspaceName?: string,
  adapter: WorkspaceAdapter = { files: [], contents: {} }
): WorkspaceNamespace {
  const documents = new Map<string, TextDocumentData>();
  const documentStates = new Map<string, { content: string; version: number }>();
  const config = new Map<string, unknown>();
  for (const [section, value] of Object.entries(adapter.configuration ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value)) config.set(`${section}.${key}`, entry);
    }
  }
  const decorations = new Map<string, TextEditorDecorationType>();
  const root = typeof workspaceRoot === "string" && workspaceRoot.trim() ? workspaceRoot : undefined;
  const name = workspaceName?.trim() || root?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || undefined;

  const namespace: WorkspaceNamespace = {
    get rootPath() { return root; },
    get name() { return name; },
    async openTextDocument(uri) {
      if (typeof uri !== "string" || !uri.trim()) throw invalid("URI de documento inválida.");
      const current = documents.get(uri);
      if (current) return current;
      if (!Object.prototype.hasOwnProperty.call(adapter.contents, uri)) throw invalid(`Documento '${uri}' não disponível no workspace adapter.`);
      const state = { content: adapter.contents[uri] ?? "", version: 1 };
      const document: TextDocumentData = {
        uri,
        get version() { return state.version; },
        get lineCount() { return state.content.split("\n").length; },
        text() { return state.content; },
      };
      documents.set(uri, document);
      documentStates.set(uri, state);
      return document;
    },
    openTextDocuments() { return Array.from(documents.values()); },
    async saveTextDocument(uri) {
      const doc = documents.get(uri);
      if (!doc) return false;
      if (!adapter.save) return false;
      const success = await adapter.save(uri, doc.text());
      return success;
    },
    applyTextEdits(uri, expectedVersion, edits) {
      const state = documentStates.get(uri);
      if (!state || !Number.isSafeInteger(expectedVersion) || !Array.isArray(edits)) throw invalid("Edição de documento inválida.");
      if (state.version !== expectedVersion) throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Versão do documento divergente.");
      const ordered = [...edits];
      for (const edit of ordered) {
        if (!edit || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) ||
            edit.start < 0 || edit.end < edit.start || edit.end > state.content.length || typeof edit.text !== "string") {
          throw invalid("Intervalo de edição inválido.");
        }
      }
      ordered.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (previous && current && (current.start < previous.end || current.start === previous.start)) throw invalid("Edições sobrepostas.");
      }
      if (!ordered.length) return true;
      let result = state.content;
      for (const edit of ordered.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      state.content = result;
      state.version += 1;
      return true;
    },
    async findFiles(includePattern, excludePattern, maxResults) {
      const validatePattern = (pattern: unknown, label: string): string => {
        if (typeof pattern !== "string" || pattern.trim().length === 0 || pattern.includes("\0")) {
          throw invalid(`Padrão de ${label} inválido.`);
        }
        const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
        if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
          throw invalid(`Padrão de ${label} fora do workspace.`);
        }
        return normalized;
      };
      const includeGlob = validatePattern(includePattern, "inclusão");
      const excludeGlob = excludePattern === undefined ? undefined : validatePattern(excludePattern, "exclusão");
      if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 0)) {
        throw invalid("maxResults deve ser um inteiro não negativo.");
      }
      const compileGlob = (glob: string): RegExp => {
        let expression = "^";
        for (let index = 0; index < glob.length; index += 1) {
          const char = glob[index];
          if (char === "*") {
            if (glob[index + 1] === "*") {
              index += 1;
              if (glob[index + 1] === "/") {
                index += 1;
                expression += "(?:.*/)?";
              } else expression += ".*";
            } else expression += "[^/]*";
          } else if (char === "?") expression += "[^/]";
          else expression += char?.replace(/[|{}()[\]^$+?.]/g, "\\$&") ?? "";
        }
        return new RegExp(`${expression}$`);
      };
      const include = compileGlob(includeGlob);
      const exclude = excludeGlob === undefined ? undefined : compileGlob(excludeGlob);
      const relativePath = (file: WorkspaceFile): string => {
        let pathname = file.uri;
        try {
          pathname = new URL(file.uri).pathname;
          pathname = decodeURIComponent(pathname);
        } catch { /* URI pode ser um caminho relativo fornecido pelo adapter. */ }
        pathname = pathname.replace(/\\/g, "/");
        const rootPath = root?.replace(/\\/g, "/").replace(/\/$/, "");
        if (rootPath && pathname.startsWith(`${rootPath}/`)) pathname = pathname.slice(rootPath.length + 1);
        else if (pathname.startsWith("/")) pathname = pathname.replace(/^\/+/, "");
        const fromName = file.name.replace(/\\/g, "/");
        if (!pathname || pathname === file.uri || (!pathname.includes("/") && fromName.includes("/"))) pathname = fromName;
        const segments: string[] = [];
        for (const segment of pathname.split("/")) {
          if (!segment || segment === ".") continue;
          if (segment === "..") throw invalid("Caminho de arquivo fora do workspace.");
          segments.push(segment);
        }
        return segments.join("/");
      };
      const matches = adapter.files.filter((file) => {
        const path = relativePath(file);
        return include.test(path) && !exclude?.test(path);
      });
      return maxResults === undefined ? matches : matches.slice(0, maxResults);
    },
    getConfigurationSection(section) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of config) if (key.startsWith(`${section}.`)) result[key.slice(section.length + 1)] = value;
      return Object.keys(result).length ? result : undefined;
    },
    createTextEditorDecorationType(options) {
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw invalid("Opções de decoração inválidas.");
      }
      const stringFields = [
        "outlineColor", "backgroundColor", "overlineColor", "textDecoration",
        "hoverMessage", "margin", "borderWidth", "borderStyle", "borderRadius",
      ] as const;
      for (const field of stringFields) {
        const value: unknown = options[field];
        if (value !== undefined && typeof value !== "string") {
          throw invalid(`Campo '${field}' da decoração deve ser string.`);
        }
      }
      for (const field of ["opacity", "zIndex"] as const) {
        const value: unknown = options[field];
        if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
          throw invalid(`Campo '${field}' da decoração deve ser número finito.`);
        }
      }
      const id = `decoration-${decorations.size}`;
      const decoration = { id, ...options };
      decorations.set(id, decoration);
      return decoration;
    },
  };
  return namespace;
}
