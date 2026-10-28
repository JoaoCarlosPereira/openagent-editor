import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

/** Tipo de comando registrado no painel de comandos. */
export interface CommandEntry {
  command: string;
  callback: (...args: unknown[]) => unknown;
}

export interface CommandRegistration {
  commandId: string;
  callback: (...args: unknown[]) => unknown;
}

/** Namespace de comandos da API de extensões. */
export interface CommandsNamespace {
  registerCommand(
    commandId: string,
    callback: (...args: unknown[]) => unknown
  ): CommandRegistration;
  unregisterCommand(commandId: string): void;
  getRegisteredCommands(): CommandEntry[];
  executeCommand<T>(commandId: string, ...args: unknown[]): Promise<T>;
}

/** Item da barra de status (parte inferior da janela) */
export interface StatusBarItem {
  id: string;
  alignment: "right" | "left";
  text: string;
  color?: string;
  tooltip?: string;
}

/** Namespace de janela da API de extensões. */
export interface WindowNamespace {
  showInformationMessage(message: string, ...options: unknown[]): Promise<unknown>;
  showWarningMessage(message: string, ...options: unknown[]): Promise<unknown>;
  showErrorMessage(message: string, ...options: unknown[]): Promise<unknown>;
  createStatusBarItem(id: string, alignment: "right" | "left"): StatusBarItem;
  getStatusBarItems(): StatusBarItem[];
  showInputBox(options?: Record<string, unknown>): Promise<string | undefined>;
}

/** Representação de um arquivo no workspace */
export interface WorkspaceFile {
  uri: string;
  name: string;
  isDirectory: boolean;
}

/** Documento aberto no editor */
export interface TextDocumentData {
  uri: string;
  version: number;
  lineCount: number;
  text(): string;
}

/** Tipo de decoração aplicada a um editor de texto */
export interface TextEditorDecorationType {
  id: string;
  hoverMessage?: string | unknown;
  outlineColor?: string;
  backgroundColor?: string;
  margin?: string | unknown;
  borderWidth?: string | unknown;
  borderStyle?: string;
  borderRadius?: string | unknown;
  overlineColor?: string;
  textDecoration?: string;
  opacity?: number;
  zIndex?: number;
}

/** Namespace de workspace da API de extensões. */
export interface WorkspaceNamespace {
  readonly rootPath?: string;
  readonly name?: string;
  openTextDocument(uri: string): Promise<TextDocumentData>;
  openTextDocuments(): TextDocumentData[];
  saveTextDocument(uri: string): Promise<boolean>;
  findFiles(
    includePattern: string,
    excludePattern?: string,
    maxResults?: number
  ): Promise<WorkspaceFile[]>;
  getConfigurationSection(section: string): Record<string, unknown> | undefined;
  createTextEditorDecorationType(
    options: Omit<TextEditorDecorationType, "id">
  ): TextEditorDecorationType;
}

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
      const content = adapter.contents[uri] ?? "";
      const document: TextDocumentData = {
        uri, version: 1,
        get lineCount() { return content.length === 0 ? 1 : content.split("\n").length; },
        text() { return content; },
      };
      documents.set(uri, document);
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
    async findFiles(includePattern, excludePattern, maxResults) {
      if (!includePattern.trim()) throw invalid("Padrão de inclusão inválido.");
      const wildcard = (pattern: string) => {
        const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\\]\\\\]/g, "\\\\$&"));
        return new RegExp(`^${escaped.join(".*")}$`);
      };
      const include = wildcard(includePattern);
      const exclude = excludePattern ? wildcard(excludePattern) : undefined;
      const matches = adapter.files.filter((file) => include.test(file.name) && !exclude?.test(file.name));
      return maxResults === undefined ? matches : matches.slice(0, maxResults);
    },
    getConfigurationSection(section) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of config) if (key.startsWith(`${section}.`)) result[key.slice(section.length + 1)] = value;
      return Object.keys(result).length ? result : undefined;
    },
    createTextEditorDecorationType(options) {
      const id = `decoration-${decorations.size}`;
      const decoration = { id, ...options };
      decorations.set(id, decoration);
      return decoration;
    },
  };
  return namespace;
}
