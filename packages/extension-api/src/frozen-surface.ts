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

// ─── Namespace: commands ─────────────────────────────────────────────────────────

/** Tipo de comando registrado no painel de comandos. */
export interface CommandEntry {
  command: string;
  /** Callback executado quando o comando é invocado */
  callback: (...args: unknown[]) => unknown;
}

export interface CommandRegistration {
  commandId: string;
  /** Função a ser chamada quando o comando é executado */
  callback: (...args: unknown[]) => unknown;
}

/** Namespace de comandos da API de extensões. */
export interface CommandsNamespace {
  registerCommand(
    commandId: string,
    callback: (...args: unknown[]) => unknown
  ): CommandRegistration;

  /** Desregistra um comando registrado previamente */
  unregisterCommand(commandId: string): void;

  /** Retorna a lista de comandos registrados */
  getRegisteredCommands(): CommandEntry[];

  /** Executa um comando registrado (simulado, sem efeito colateral) */
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
  /** Exibe uma mensagem informativa ao usuário (simulada, sem UI real) */
  showInformationMessage(message: string, ...options: unknown[]): Promise<unknown>;

  /** Exibe uma mensagem de aviso ao usuário */
  showWarningMessage(message: string, ...options: unknown[]): Promise<unknown>;

  /** Exibe uma mensagem de erro ao usuário */
  showErrorMessage(message: string, ...options: unknown[]): Promise<unknown>;

  /** Cria/gerencia um item na barra de status */
  createStatusBarItem(id: string, alignment: "right" | "left"): StatusBarItem;

  /** Retorna a lista de items na barra de status */
  getStatusBarItems(): StatusBarItem[];

  /** Retorna o valor atual de um input do usuário (simulado) */
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
  /** Abre um documento de texto pelo URI */
  openTextDocument(uri: string): Promise<TextDocumentData>;

  /** Retorna todos os documentos abertos */
  openTextDocuments(): TextDocumentData[];

  /** Salva um documento aberto */
  saveTextDocument(uri: string): Promise<boolean>;

  /** Obtém arquivos da pasta de trabalho (simulado) */
  findFiles(
    includePattern: string,
    excludePattern?: string,
    maxResults?: number
  ): Promise<WorkspaceFile[]>;

  /** Obtém configuração de espaço de trabalho por namespace/key */
  getConfigurationSection(section: string): Record<string, unknown> | undefined;

  /** Cria um tipo de decoração aplicada a um editor de texto */
  createTextEditorDecorationType(
    options: Omit<TextEditorDecorationType, "id">
  ): TextEditorDecorationType;
}

// ─── Namespace: languages ─────────────────────────────────────────────────────────

/** Item de completude (autocomplete) */
export interface CompletionItem {
  label: string;
  kind?: number; // CompletionItemKind
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
  /** Registra um provider de completude (autocomplete) */
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

  /** Registra um provider de assinatura (signature help) */
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

  /** Registra um provider de hover (informação ao passar o mouse) */
  registerHoverProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideHover: (
        document: TextDocumentData,
        position: { line: number; character: number }
      ) => Promise<HoverContents | undefined>;
    }
  ): unknown;

  /** Registra um provider de definição (ir para definição) */
  registerDefinitionProvider(
    selector: { scheme: string; language?: string; filepath?: string },
    provider: {
      provideDefinition: (
        document: TextDocumentData,
        position: { line: number; character: number }
      ) => Promise<DefinitionLocation[]>;
    }
  ): unknown;

  /** Registra um provider de actions de código (refatorações) */
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

  /** Registra um provider de diagnósticos (linter, type checker) */
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

/** Namespace de ambiente da API de extensões. */
export interface EnvironmentNamespace {
  /** Retorna o sistema operacional (simulado) */
  os: string;

  /** Retorna o idioma configurado (simulado) */
  language: string;

  /** Retorna a extensão padrão do editor (simulado) */
  getExtension<T>(id: string): T | undefined;

  /** Retorna dados de configuração global do extension host */
  getConfiguration(key: string): Record<string, unknown> | undefined;

  /** Retorna a versão congelada da API de extensões */
  version: FrozenVersion;

  /** Retorna o valor de uma variável de ambiente do editor (simulado) */
  getEnvironmentVariable(key: string): string | undefined;
}

// ─── Namespace: memento (persistência em memória) ────────────────────────────────

/** Dados persistentes em memória para a extensão. */
export interface MementoData {
  /** Retorna um valor pela chave (simulado, sem efeito colateral) */
  get<T>(key: string): T | undefined;

  /** Armazena um valor pela chave em memória (simulado, sem efeito colateral) */
  update(key: string, value: unknown): Promise<void>;
}

// ─── Namespace: output (canais de saída) ─────────────────────────────────────────

/** Canal de saída (output channel) */
export interface OutputChannel {
  name: string;

  /** Exibe o conteúdo do canal (simulado) */
  show(preserveScroll?: boolean): void;

  /** Limpa o conteúdo do canal */
  clear(): void;

  /** Escreve uma linha no canal (simulado, sem efeito colateral) */
  appendLine(message: string): void;

  /** Desliga o canal e descarta seu conteúdo */
  dispose(): void;
}

/** Namespace de output da API de extensões. */
export interface OutputNamespace {
  /** Cria um canal de saída com nome dado */
  createOutputChannel(
    name: string,
    preserveScroll?: boolean
  ): OutputChannel;
}

// ─── Superfície congelada completa ───────────────────────────────────────────────

/**
 * Interface completa da superfície congelada da API de extensões Cursor 3.24.18.
 *
 * Esta é a estrutura que deve ser validada pelo validador (validator.ts).
 * Cada namespace é opcional no objeto runtime, mas o validador exige a presença
 * de todos para considerar a superfície válida.
 */
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

/**
 * Cria a superfície congelada padrão — um stub coerente com os contratos.
 *
 * Nenhum efeito colateral: nenhum dado é escrito em disco ou enviado por rede.
 */
export function createFrozenSurface(): FrozenExtensionApiSurface {
  // Stub minimal e coerente com a superfície declarada.
  // As implementações reais (task_159-161) substituem estes stubs por
  // adaptadores reais contra o editor.
  const commandsStub: CommandsNamespace = {
    registerCommand(commandId, callback) {
      return { commandId, callback };
    },
    unregisterCommand() {
      /* stub */
    },
    getRegisteredCommands() {
      return [];
    },
    async executeCommand<T>(commandId: string, ...args: unknown[]): Promise<T> {
      // Stub: sem efeito colateral. A implementação real (task_159) delega ao command bus.
      void commandId; // sinaliza uso deliberado do parâmetro
      void args;
      return undefined as unknown as T;
    },
  };

  const windowStub: WindowNamespace = {
    async showInformationMessage() {
      return undefined;
    },
    async showWarningMessage() {
      return undefined;
    },
    async showErrorMessage() {
      return undefined;
    },
    createStatusBarItem(id, alignment) {
      return { id, alignment, text: "" };
    },
    getStatusBarItems() {
      return [];
    },
    async showInputBox() {
      return undefined;
    },
  };

  const workspaceStub: WorkspaceNamespace = {
    async openTextDocument() {
      return {
        uri: "",
        version: 0,
        lineCount: 0,
        text() {
          return "";
        },
      };
    },
    openTextDocuments() {
      return [];
    },
    async saveTextDocument() {
      return false;
    },
    async findFiles() {
      return [];
    },
    getConfigurationSection() {
      return undefined;
    },
    createTextEditorDecorationType(options) {
      return { id: "", ...options };
    },
  };

  const languagesStub: LanguagesNamespace = {
    registerCompletionProvider() {
      return undefined;
    },
    registerSignatureHelpProvider() {
      return undefined;
    },
    registerHoverProvider() {
      return undefined;
    },
    registerDefinitionProvider() {
      return undefined;
    },
    registerCodeActionsProvider() {
      return undefined;
    },
    registerDiagnosticProvider() {
      return undefined;
    },
  };

  const envStub: EnvironmentNamespace = {
    os: "unknown",
    language: "en",
    getExtension() {
      return undefined;
    },
    getConfiguration() {
      return undefined;
    },
    version: FROZEN_EXTENSION_API_VERSION,
    getEnvironmentVariable() {
      return undefined;
    },
  };

  const mementoStub: MementoData = {
    get() {
      return undefined;
    },
    async update() {
      /* stub */
    },
  };

  const outputStub: OutputNamespace = {
    createOutputChannel(name) {
      return {
        name,
        show() {
          /* stub */
        },
        clear() {
          /* stub */
        },
        appendLine() {
          /* stub */
        },
        dispose() {
          /* stub */
        },
      };
    },
  };

  return {
    version: FROZEN_EXTENSION_API_VERSION,
    commands: commandsStub,
    window: windowStub,
    workspace: workspaceStub,
    languages: languagesStub,
    env: envStub,
    memento: mementoStub,
    output: outputStub,
  };
}

// ─── Chaves públicas esperadas (para validação) ──────────────────────────────────

/** Lista das chaves obrigatórias na superfície congelada (top-level namespaces) */
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

/**
 * Mapa de tipos esperados para cada chave (para verificação estática de tipo).
 */
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
