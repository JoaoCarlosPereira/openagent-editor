import {
  createCommandsNamespace as _createCommandsNamespace,
  createWindowNamespace as _createWindowNamespace,
  createWorkspaceNamespace as _createWorkspaceNamespace,
} from "./namespace-impl.js";
import type { WorkspaceAdapter, WindowAdapter } from "./namespace-impl.js";

export type { WorkspaceAdapter, WindowAdapter } from "./namespace-impl.js";

/**
 * frozen-surface.ts — Superfície congelada da API de extensões do Cursor 3.24.18.
 *
 * Esta fixture define o contrato verificável que congela a forma da API pública
 * de extensões na versão 3.24.18. Serve como oráculo para as tarefas seguintes:
 *   - task_159: commands, window, workspace
 *   - task_160: documentos, edições, decorações
 *   - task_161: language providers
 *
 * Estratégia de proveniência: behavioral-reimplementation (ADR-002).
 * Nunca usar direct-authorized sem documento de autorização explícito.
 */

// ─── Versão congelada ────────────────────────────────────────────────────────────

/**
 * Identificador de versão da superfície congelada.
 * De acordo com ADR-007: "Cursor 3.24.18 será o oráculo congelado dos testes
 * diferenciais."
 */
export const FROZEN_EXTENSION_API_VERSION = "3.24.18" as const;

export type FrozenVersion = typeof FROZEN_EXTENSION_API_VERSION;

// ─── Re-exports de tipos ────────────────────────────────────────────────────────

// ─── Namespace: commands ─────────────────────────────────────────────────────────

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

// ─── Namespace: window ────────────────────────────────────────────────────────────

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

// ─── Namespace: workspace ─────────────────────────────────────────────────────────

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

/** Representação de um arquivo no workspace */
export interface WorkspaceFile {
  uri: string;
  name: string;
  isDirectory: boolean;
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

// ─── Namespace: languages ─────────────────────────────────────────────────────────

/** Item de completude (autocomplete) */
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: "markdown"; value: string };
  preselect?: boolean;
}

export interface SignatureParameterInfo {
  name: string;
  type: string;
}

export interface SignatureInfo {
  label: string;
  parameters: SignatureParameterInfo[];
  activeParameter: number;
}

export interface SignatureHelp {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

export interface HoverContents {
  kind: "markdown";
  value: string;
}

export interface DefinitionLocation {
  uri: string;
  line: number;
  column: number;
}

export interface CodeActionKind {
  value: string;
}

export interface CodeActionContext {
  error?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  only?: string;
  triggers?: string[];
}

export interface CodeAction {
  title: string;
  kind?: CodeActionKind;
  edit?: unknown;
  command?: string;
}

export interface DiagnosticSeverityCodes {
  error: 0;
  warning: 1;
  information: 2;
}

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  severity?: DiagnosticSeverityCodes[keyof DiagnosticSeverityCodes];
  code?: string | unknown;
  source?: string;
}

/** Namespace de languages da API de extensões. */
export interface LanguagesNamespace {
  registerCompletionProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      resolveCompletionItem?: (item: CompletionItem) => Promise<CompletionItem>;
      provideCompletionItems: (
        document: TextDocumentData,
        position: { line: number; character: number }
      ) => Promise<CompletionItem[]>;
    },
    triggerCharacters?: string[]
  ): unknown;
  registerSignatureHelpProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideSignatureHelp: (
        document: TextDocumentData,
        position: { line: number; character: number },
        token?: unknown
      ) => Promise<SignatureHelp>;
    }
  ): unknown;
  registerHoverProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideHover: (
        document: TextDocumentData,
        position: { line: number; character: number }
      ) => Promise<HoverContents | undefined>;
    }
  ): unknown;
  registerDefinitionProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideDefinition: (
        document: TextDocumentData,
        position: { line: number; character: number }
      ) => Promise<DefinitionLocation[]>;
    }
  ): unknown;
  registerCodeActionsProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideCodeActions: (
        document: TextDocumentData,
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        },
        context: CodeActionContext
      ) => Promise<CodeAction[]>;
    }
  ): unknown;
  registerDiagnosticProvider(
    documentSelector: { scheme?: string; language?: string; filepath?: string }[],
    owner: string,
    provider: {
      provideDiagnostics: (
        document: TextDocumentData
      ) => Promise<Diagnostic[]>;
    }
  ): unknown;
}

// ─── Namespace: env ───────────────────────────────────────────────────────────────

export interface EnvironmentNamespace {
  os: string;
  language: string;
  getExtension<T>(id: string): T | undefined;
  getConfiguration(key: string): Record<string, unknown> | undefined;
  version: FrozenVersion;
  getEnvironmentVariable(key: string): string | undefined;
}

// ─── Namespace: memento (persistência em memória) ────────────────────────────────

export interface MementoData {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

// ─── Namespace: output (canais de saída) ─────────────────────────────────────────

export interface OutputChannel {
  name: string;
  show(preserveScroll?: boolean): void;
  clear(): void;
  appendLine(message: string): void;
  dispose(): void;
}

export interface OutputNamespace {
  createOutputChannel(
    name: string,
    preserveScroll?: boolean
  ): OutputChannel;
}

// ─── Superfície congelada completa ───────────────────────────────────────────────

export interface FrozenExtensionApiSurface {
  version: FrozenVersion;
  commands: CommandsNamespace;
  window: WindowNamespace;
  workspace: WorkspaceNamespace;
  languages: LanguagesNamespace;
  env: EnvironmentNamespace;
  memento: MementoData;
  output: OutputNamespace;
}

// ─── Re-exports de factories ────────────────────────────────────────────────────

export {
  _createCommandsNamespace as createCommandsNamespace,
  _createWindowNamespace as createWindowNamespace,
  _createWorkspaceNamespace as createWorkspaceNamespace,
};

/**
 * Cria a superfície congelada padrão com implementações reais dos
 * namespaces commands, window e workspace (task_159).
 *
 * Nenhum efeito colateral: nenhum dado é escrito em disco ou enviado por rede.
 * Os namespaces commands, window, workspace são funcionais.
 * Os namespaces restantes (languages, env, memento, output) permanecem
 * como stubs — sua implementação funcional cabe a task_160+ e task_161.
 */
export function createFrozenSurface(
  workspaceRoot?: string,
  workspaceName?: string,
  windowAdapter?: WindowAdapter,
  workspaceAdapter?: WorkspaceAdapter
): FrozenExtensionApiSurface {
  const commands = _createCommandsNamespace();
  const windowNs = _createWindowNamespace(windowAdapter);
  const workspaceNs = _createWorkspaceNamespace(
    workspaceRoot,
    workspaceName,
    workspaceAdapter
  );

  const languagesStub: LanguagesNamespace = {
    registerCompletionProvider() { return undefined; },
    registerSignatureHelpProvider() { return undefined; },
    registerHoverProvider() { return undefined; },
    registerDefinitionProvider() { return undefined; },
    registerCodeActionsProvider() { return undefined; },
    registerDiagnosticProvider() { return undefined; },
  };

  const envStub: EnvironmentNamespace = {
    os: "unknown",
    language: "en",
    getExtension() { return undefined; },
    getConfiguration() { return undefined; },
    version: FROZEN_EXTENSION_API_VERSION,
    getEnvironmentVariable() { return undefined; },
  };

  const mementoStub: MementoData = {
    get() { return undefined; },
    async update() { /* stub */ },
  };

  const outputStub: OutputNamespace = {
    createOutputChannel(name) {
      const channel: OutputChannel = {
        name: name ?? "",
        show() { /* stub */ },
        clear() { /* stub */ },
        appendLine() { /* stub */ },
        dispose() { /* stub */ },
      };
      return channel;
    },
  };

  return {
    version: FROZEN_EXTENSION_API_VERSION,
    commands,
    window: windowNs,
    workspace: workspaceNs,
    languages: languagesStub,
    env: envStub,
    memento: mementoStub,
    output: outputStub,
  };
}

// ─── Chaves públicas esperadas (para validação) ──────────────────────────────────

export const EXPECTED_SURFACE_KEYS: (keyof FrozenExtensionApiSurface)[] = [
  "version",
  "commands",
  "window",
  "workspace",
  "languages",
  "env",
  "memento",
  "output",
];

export const EXPECTED_SURFACE_TYPES: Record<string, string> = {
  version: "string",
  commands: "object",
  window: "object",
  workspace: "object",
  languages: "object",
  env: "object",
  memento: "object",
  output: "object",
};
