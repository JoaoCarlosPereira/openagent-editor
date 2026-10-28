import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { ProtocolError } from "@openagent/protocol";

import {
  createOpenAgentProductIdentity,
  type ElectronProductIdentity,
} from "../main/product-identity.js";
import {
  FILE_TREE_DIRECTORY_REQUIRED_MESSAGE,
  listFileTreeDirectory,
  type FileTreeEntry,
} from "./file-tree.js";
import {
  createRendererToolBridge,
  type RendererToolBridge,
} from "./renderer-tool-boundary.js";
import {
  applyTextEditorEdit,
  openTextEditorDocument,
  saveTextEditorDocument,
  TEXT_EDITOR_FOLDER_REQUIRED_MESSAGE,
  type TextEditorDocument,
} from "./text-editor.js";
import {
  loadIntegratedGitDiff,
  openIntegratedGitPanel,
  refreshIntegratedGitStatus,
  type IntegratedGitPanel,
} from "./git-panel.js";
import {
  openIntegratedTerminal,
  runIntegratedTerminalCommand,
  setIntegratedTerminalCwd,
  type IntegratedTerminalSession,
} from "./terminal.js";
import {
  continueIntegratedDebug,
  DEBUG_NO_SESSION_MESSAGE,
  openIntegratedDebugSession,
  removeIntegratedBreakpoint,
  setIntegratedBreakpoint,
  startIntegratedDebugSession,
  stepOverIntegratedDebug,
  stopIntegratedDebugSession,
  type IntegratedDebugSession,
} from "./debug-session.js";
import {
  buildWorkbenchShellView,
  type WorkbenchShellViewSnapshot,
} from "./workbench-shell-view.js";
import {
  assertWorkbenchPanelWidthPx,
  assertWorkbenchTheme,
  WORKBENCH_PANEL_WIDTH_DEFAULT_PX,
  WORKBENCH_THEME_DEFAULT,
  type WorkbenchTheme,
} from "./theme.js";
import {
  createDefaultWorkbenchHealth,
  updateWorkbenchSubsystemHealth,
  type WorkbenchHealthSnapshot,
} from "./health-indicator.js";

export type { WorkbenchShellViewSnapshot, WorkbenchCapabilitySlot } from "./workbench-shell-view.js";
export {
  buildWorkbenchShellView,
  WORKBENCH_CAPABILITY_SLOTS,
} from "./workbench-shell-view.js";
export {
  assertRendererMayNotInvokeTool,
  createRendererToolBridge,
  RENDERER_TOOLS_FORBIDDEN_MESSAGE,
  type EditorProcessRole,
  type RendererToolBridge,
  type RendererToolInvokeAttempt,
} from "./renderer-tool-boundary.js";
export {
  listFileTreeDirectory,
  FILE_TREE_ROOT_REQUIRED_MESSAGE,
  FILE_TREE_DIRECTORY_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  type FileTreeEntry,
  type FileTreeEntryKind,
} from "./file-tree.js";
export {
  buildFileTreeView,
  type FileTreeViewInput,
  type FileTreeViewSnapshot,
} from "./file-tree-view.js";
export {
  openTextEditorDocument,
  applyTextEditorEdit,
  saveTextEditorDocument,
  TEXT_EDITOR_FOLDER_REQUIRED_MESSAGE,
  TEXT_EDITOR_PATH_REQUIRED_MESSAGE,
  TEXT_EDITOR_NOT_A_FILE_MESSAGE,
  TEXT_EDITOR_NO_DOCUMENT_MESSAGE,
  TEXT_EDITOR_CONTENT_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE as TEXT_EDITOR_OUT_OF_SCOPE_MESSAGE,
  type TextEditorDocument,
} from "./text-editor.js";
export {
  buildTextEditorView,
  type TextEditorViewInput,
  type TextEditorViewSnapshot,
} from "./text-editor-view.js";
export {
  openIntegratedTerminal,
  runIntegratedTerminalCommand,
  setIntegratedTerminalCwd,
  TERMINAL_FOLDER_REQUIRED_MESSAGE,
  TERMINAL_NO_SESSION_MESSAGE,
  TERMINAL_COMMAND_REQUIRED_MESSAGE,
  TERMINAL_DIRECTORY_REQUIRED_MESSAGE,
  TERMINAL_NOT_A_DIRECTORY_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE as TERMINAL_OUT_OF_SCOPE_MESSAGE,
  type IntegratedTerminalSession,
  type IntegratedTerminalStatus,
} from "./terminal.js";
export {
  buildTerminalView,
  type TerminalViewInput,
  type TerminalViewSnapshot,
} from "./terminal-view.js";
export {
  openIntegratedGitPanel,
  refreshIntegratedGitStatus,
  loadIntegratedGitDiff,
  GIT_PANEL_FOLDER_REQUIRED_MESSAGE,
  GIT_PANEL_NO_PANEL_MESSAGE,
  GIT_PANEL_NOT_A_REPOSITORY_MESSAGE,
  GIT_PANEL_PATH_REQUIRED_MESSAGE,
  GIT_PANEL_STATUS_FAILED_MESSAGE,
  GIT_PANEL_DIFF_FAILED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE as GIT_PANEL_OUT_OF_SCOPE_MESSAGE,
  type IntegratedGitPanel,
} from "./git-panel.js";
export {
  buildGitPanelView,
  type GitPanelViewInput,
  type GitPanelViewSnapshot,
} from "./git-panel-view.js";
export {
  openIntegratedDebugSession,
  startIntegratedDebugSession,
  stopIntegratedDebugSession,
  setIntegratedBreakpoint,
  removeIntegratedBreakpoint,
  continueIntegratedDebug,
  stepOverIntegratedDebug,
  DEBUG_FOLDER_REQUIRED_MESSAGE,
  DEBUG_NO_SESSION_MESSAGE,
  DEBUG_TARGET_PATH_REQUIRED_MESSAGE,
  DEBUG_BREAKPOINT_PATH_REQUIRED_MESSAGE,
  DEBUG_BREAKPOINT_LINE_INVALID_MESSAGE,
  DEBUG_BREAKPOINT_NOT_FOUND_MESSAGE,
  DEBUG_SESSION_TERMINATED_MESSAGE,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE as DEBUG_OUT_OF_SCOPE_MESSAGE,
  type IntegratedDebugSession,
  type DebugBreakpoint,
  type DebugStatus,
  type StartDebugInput,
} from "./debug-session.js";
export {
  buildDebugView,
  type DebugViewInput,
  type DebugViewSnapshot,
} from "./debug-view.js";
export {
  assertWorkbenchPanelWidthPx,
  assertWorkbenchTheme,
  isWorkbenchTheme,
  themeTokensCssVariables,
  WORKBENCH_PANEL_WIDTH_DEFAULT_PX,
  WORKBENCH_PANEL_WIDTH_MAX_PX,
  WORKBENCH_PANEL_WIDTH_MIN_PX,
  WORKBENCH_THEME_DEFAULT,
  WORKBENCH_THEME_TOKENS,
  WORKBENCH_THEMES,
  type WorkbenchTheme,
  type WorkbenchThemeTokens,
} from "./theme.js";

export const WORKBENCH_FOLDER_REQUIRED_MESSAGE =
  "Caminho de pasta obrigatório para abrir o workbench OpenAgent.";
export const WORKBENCH_FOLDER_INVALID_MESSAGE =
  "Pasta inválida: o caminho não existe ou não é um diretório.";
export const WORKBENCH_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para expandir a árvore.";
export const WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para editar arquivos.";
export const WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para o terminal integrado.";
export const WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para o painel Git.";
export const WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para depuração.";

export interface WorkbenchShellOpenInput {
  platform: string;
  folderPath?: unknown;
  repoRoot?: string;
  theme?: unknown;
  panelWidthPx?: unknown;
}

export interface WorkbenchShellOpenResult {
  identity: ElectronProductIdentity;
  folderPath: string;
  fileTreeEntries: readonly FileTreeEntry[];
  view: WorkbenchShellViewSnapshot;
}

export interface WorkbenchTextEditorResult {
  document: TextEditorDocument;
  view: WorkbenchShellViewSnapshot;
}

export interface WorkbenchTerminalResult {
  session: IntegratedTerminalSession;
  view: WorkbenchShellViewSnapshot;
}

export interface WorkbenchGitPanelResult {
  panel: IntegratedGitPanel;
  view: WorkbenchShellViewSnapshot;
}

export interface WorkbenchDebugResult {
  session: IntegratedDebugSession;
  view: WorkbenchShellViewSnapshot;
}

/**
 * Flatten entradas da raiz + filhos de diretórios expandidos (ordem de exibição).
 */
function collectVisibleEntries(
  rootFolder: string,
  expandedDirectories: readonly string[],
): FileTreeEntry[] {
  const rootEntries = listFileTreeDirectory(rootFolder, "");
  const visible: FileTreeEntry[] = [...rootEntries];
  const expandedSorted = [...expandedDirectories].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );

  for (const relativeDir of expandedSorted) {
    const children = listFileTreeDirectory(rootFolder, relativeDir);
    const insertAt = visible.findIndex((entry) => entry.relativePath === relativeDir);
    if (insertAt === -1) {
      visible.push(...children);
      continue;
    }
    visible.splice(insertAt + 1, 0, ...children);
  }
  return visible;
}

function assertFolderPath(folderPath: unknown): string {
  if (typeof folderPath !== "string" || folderPath.trim() === "") {
    throw new ProtocolError("INVALID_STATE", WORKBENCH_FOLDER_REQUIRED_MESSAGE, [
      `folderPath=${String(folderPath)}`,
    ]);
  }
  const resolved = path.resolve(folderPath.trim());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new ProtocolError("INVALID_STATE", WORKBENCH_FOLDER_INVALID_MESSAGE, [
      `folderPath=${resolved}`,
    ]);
  }
  return resolved;
}

/**
 * LOC-01 / UI-02: workbench Electron — slots, árvore, editor, terminal, Git, debug e temas claro/escuro com tokens próprios.
 */
export class WorkbenchShellController {
  private identity: ElectronProductIdentity = createOpenAgentProductIdentity();
  private folderPath: string | null = null;
  private platform = "linux";
  private daemonConnected = false;
  private fileTreeEntries: FileTreeEntry[] = [];
  private expandedDirectories: string[] = [];
  private textEditorDocument: TextEditorDocument | null = null;
  private terminalSession: IntegratedTerminalSession | null = null;
  private gitPanel: IntegratedGitPanel | null = null;
  private debugSession: IntegratedDebugSession | null = null;
  private themeState: WorkbenchTheme = WORKBENCH_THEME_DEFAULT;
  private panelWidthState: number = WORKBENCH_PANEL_WIDTH_DEFAULT_PX;
  private healthState: WorkbenchHealthSnapshot = createDefaultWorkbenchHealth();
  private readonly rendererBridge: RendererToolBridge = createRendererToolBridge();
  private view: WorkbenchShellViewSnapshot = buildWorkbenchShellView({
    identity: this.identity,
    folderPath: null,
    platform: this.platform,
    daemonConnected: false,
    toolsAllowedInRenderer: false,
    fileTreeEntries: [],
    expandedDirectories: [],
    textEditorDocument: null,
    terminalSession: null,
    gitPanel: null,
    debugSession: null,
    theme: this.themeState,
    panelWidthPx: this.panelWidthState,
  });

  get snapshot(): WorkbenchShellViewSnapshot {
    return this.view;
  }

  get theme(): WorkbenchTheme {
    return this.themeState;
  }

  get panelWidthPx(): number {
    return this.panelWidthState;
  }

  get health(): WorkbenchHealthSnapshot {
    return this.healthState;
  }

  setSubsystemHealth(
    subsystem: unknown,
    status: unknown,
    message: unknown,
  ): WorkbenchShellViewSnapshot {
    const nextHealth = updateWorkbenchSubsystemHealth(
      this.healthState,
      subsystem,
      status,
      message,
    );
    this.healthState = nextHealth;
    this.daemonConnected =
      nextHealth.daemon.status === "connected" || nextHealth.daemon.status === "ready";
    this.refreshView();
    return this.view;
  }

  /** Ponte do renderer: nunca permite tool.invoke (LOC-01 / ADR-003). */
  get rendererTools(): RendererToolBridge {
    return this.rendererBridge;
  }

  /** Documento aberto no editor de texto (null se nenhum). */
  get openDocument(): TextEditorDocument | null {
    return this.textEditorDocument;
  }

  /** Sessão do terminal integrado (null se fechada). */
  get openTerminalSession(): IntegratedTerminalSession | null {
    return this.terminalSession;
  }

  /** Painel Git aberto (null se fechado). */
  get openGitPanel(): IntegratedGitPanel | null {
    return this.gitPanel;
  }

  /** Sessão de depuração DAP aberta (null se fechada). */
  get openDebugSession(): IntegratedDebugSession | null {
    return this.debugSession;
  }

  /** Inicializa o shell com identidade OpenAgent antes de abrir pasta. */
  bootstrap(input: {
    platform: string;
    repoRoot?: string;
    theme?: unknown;
    panelWidthPx?: unknown;
  }): WorkbenchShellViewSnapshot {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    this.folderPath = null;
    this.daemonConnected = false;
    this.fileTreeEntries = [];
    this.expandedDirectories = [];
    this.textEditorDocument = null;
    this.terminalSession = null;
    this.gitPanel = null;
    this.debugSession = null;
    if (input.theme !== undefined) {
      this.themeState = assertWorkbenchTheme(input.theme);
    }
    if (input.panelWidthPx !== undefined) {
      this.panelWidthState = assertWorkbenchPanelWidthPx(input.panelWidthPx);
    }
    this.refreshView();
    return this.view;
  }

  /** Reflete no shell que o processo main está ligado ao harness-daemon. */
  setDaemonConnected(connected: boolean): WorkbenchShellViewSnapshot {
    if (typeof connected !== "boolean") {
      throw new ProtocolError("INVALID_STATE", "Estado de conexão do daemon inválido.", []);
    }
    return this.setSubsystemHealth(
      "daemon",
      connected ? "connected" : "disconnected",
      connected ? "Conectado" : "Desconectado",
    );
  }

  /**
   * Altera o tema ativo do workbench (UI-02).
   * Tema inválido -> INVALID_STATE sem efeito colateral.
   */
  setTheme(theme: unknown): WorkbenchShellViewSnapshot {
    this.themeState = assertWorkbenchTheme(theme);
    this.refreshView();
    return this.view;
  }

  /**
   * Altera a largura do painel em pixels (UI-02).
   * Valor fora dos limites [280, 720] -> INVALID_STATE sem efeito colateral.
   */
  setPanelWidth(panelWidthPx: unknown): WorkbenchShellViewSnapshot {
    this.panelWidthState = assertWorkbenchPanelWidthPx(panelWidthPx);
    this.refreshView();
    return this.view;
  }

  openFolder(input: WorkbenchShellOpenInput): WorkbenchShellOpenResult {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    const folderPath = assertFolderPath(input.folderPath);
    this.folderPath = folderPath;
    this.expandedDirectories = [];
    this.fileTreeEntries = collectVisibleEntries(folderPath, this.expandedDirectories);
    this.textEditorDocument = null;
    this.terminalSession = null;
    this.gitPanel = null;
    this.debugSession = null;
    if (input.theme !== undefined) {
      this.themeState = assertWorkbenchTheme(input.theme);
    }
    if (input.panelWidthPx !== undefined) {
      this.panelWidthState = assertWorkbenchPanelWidthPx(input.panelWidthPx);
    }
    this.refreshView();
    return {
      identity: this.identity,
      folderPath,
      fileTreeEntries: this.fileTreeEntries,
      view: this.view,
    };
  }

  /**
   * Expande um diretório da árvore sob a pasta aberta.
   * Fora do root → OUT_OF_SCOPE; sem pasta / dir inválido → INVALID_STATE.
   */
  expandDirectory(relativeDirectory: unknown): WorkbenchShellViewSnapshot {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (typeof relativeDirectory !== "string" || relativeDirectory.trim() === "") {
      throw new ProtocolError("INVALID_STATE", FILE_TREE_DIRECTORY_REQUIRED_MESSAGE, [
        `relativeDirectory=${String(relativeDirectory)}`,
      ]);
    }
    const relative = relativeDirectory.trim().split(path.sep).join("/");
    // Valida confinamento e existência antes de marcar expandido.
    listFileTreeDirectory(this.folderPath, relative);
    if (!this.expandedDirectories.includes(relative)) {
      this.expandedDirectories = [...this.expandedDirectories, relative];
    }
    this.fileTreeEntries = collectVisibleEntries(this.folderPath, this.expandedDirectories);
    this.refreshView();
    return this.view;
  }

  /**
   * Abre um arquivo de texto sob a pasta (LOC-01 / task_121).
   * Fora do root → OUT_OF_SCOPE; path inválido → INVALID_STATE.
   */
  openTextFile(relativePath: unknown): WorkbenchTextEditorResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.textEditorDocument = openTextEditorDocument(this.folderPath, relativePath);
    this.refreshView();
    return { document: this.textEditorDocument, view: this.view };
  }

  /** Edita o buffer do documento aberto (sem gravar disco). */
  editTextDocument(content: unknown): WorkbenchTextEditorResult {
    this.textEditorDocument = applyTextEditorEdit(this.textEditorDocument, content);
    this.refreshView();
    return { document: this.textEditorDocument, view: this.view };
  }

  /** Salva o documento aberto no disco sob a pasta. */
  saveTextDocument(): WorkbenchTextEditorResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE, [
        TEXT_EDITOR_FOLDER_REQUIRED_MESSAGE,
      ]);
    }
    this.textEditorDocument = saveTextEditorDocument(this.folderPath, this.textEditorDocument);
    this.refreshView();
    return { document: this.textEditorDocument, view: this.view };
  }

  /**
   * Abre o terminal integrado com CWD na pasta (LOC-01 / task_122).
   * Sem pasta → INVALID_STATE.
   */
  openTerminal(): WorkbenchTerminalResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.terminalSession = openIntegratedTerminal(this.folderPath);
    this.refreshView();
    return { session: this.terminalSession, view: this.view };
  }

  /**
   * Executa comando no terminal aberto (I/O no main; cwd confinado).
   */
  runTerminalCommand(command: unknown): WorkbenchTerminalResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.terminalSession = runIntegratedTerminalCommand(
      this.folderPath,
      this.terminalSession,
      command,
    );
    this.refreshView();
    return { session: this.terminalSession, view: this.view };
  }

  /**
   * Altera o CWD relativo do terminal sob a pasta.
   * Fora do root → OUT_OF_SCOPE; path inválido → INVALID_STATE.
   */
  setTerminalCwd(relativeDirectory: unknown): WorkbenchTerminalResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_TERMINAL_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.terminalSession = setIntegratedTerminalCwd(
      this.folderPath,
      this.terminalSession,
      relativeDirectory,
    );
    this.refreshView();
    return { session: this.terminalSession, view: this.view };
  }

  /**
   * Abre o painel Git e carrega status (LOC-01 / task_123).
   * Sem pasta / sem .git → INVALID_STATE.
   */
  openGit(): WorkbenchGitPanelResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.gitPanel = openIntegratedGitPanel(this.folderPath);
    this.refreshView();
    return { panel: this.gitPanel, view: this.view };
  }

  /** Atualiza o status Git do painel aberto. */
  refreshGitStatus(): WorkbenchGitPanelResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.gitPanel = refreshIntegratedGitStatus(this.folderPath, this.gitPanel);
    this.refreshView();
    return { panel: this.gitPanel, view: this.view };
  }

  /**
   * Carrega git diff no painel (workspace ou caminho relativo).
   * Fora do root → OUT_OF_SCOPE; path inválido → INVALID_STATE.
   */
  loadGitDiff(relativePath?: unknown): WorkbenchGitPanelResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_GIT_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.gitPanel = loadIntegratedGitDiff(this.folderPath, this.gitPanel, relativePath);
    this.refreshView();
    return { panel: this.gitPanel, view: this.view };
  }

  /**
   * Abre uma sessão de depuração DAP no workbench (LOC-01 / task_124).
   * Sem pasta aberta → INVALID_STATE; alvo fora do escopo → OUT_OF_SCOPE.
   */
  openDebug(targetPath: unknown): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    this.debugSession = openIntegratedDebugSession(this.folderPath, {
      targetPath: targetPath as string,
    });
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /** Inicia a execução da sessão DAP aberta. */
  startDebug(): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = startIntegratedDebugSession(this.debugSession);
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /** Encerra a sessão DAP aberta. */
  stopDebug(): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = stopIntegratedDebugSession(this.debugSession);
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /**
   * Adiciona um breakpoint na sessão DAP.
   * Fora do root → OUT_OF_SCOPE; path/linha inválido → INVALID_STATE.
   */
  setDebugBreakpoint(relativePath: unknown, line: unknown): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = setIntegratedBreakpoint(
      this.debugSession,
      this.folderPath,
      relativePath,
      line,
    );
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /** Remove um breakpoint na sessão DAP. */
  removeDebugBreakpoint(breakpointId: unknown): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = removeIntegratedBreakpoint(this.debugSession, breakpointId);
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /** Continua a execução até próximo breakpoint (simulação de hit). */
  continueDebug(): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = continueIntegratedDebug(this.debugSession);
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  /** Avança uma linha (step over) na sessão DAP. */
  stepOverDebug(): WorkbenchDebugResult {
    if (this.folderPath === null) {
      throw new ProtocolError("INVALID_STATE", WORKBENCH_DEBUG_FOLDER_NOT_OPEN_MESSAGE, []);
    }
    if (this.debugSession === null) {
      throw new ProtocolError("INVALID_STATE", DEBUG_NO_SESSION_MESSAGE, []);
    }
    this.debugSession = stepOverIntegratedDebug(this.debugSession);
    this.refreshView();
    return { session: this.debugSession, view: this.view };
  }

  private refreshView(): void {
    this.view = buildWorkbenchShellView({
      identity: this.identity,
      folderPath: this.folderPath,
      platform: this.platform,
      daemonConnected: this.daemonConnected,
      toolsAllowedInRenderer: false,
      fileTreeEntries: this.fileTreeEntries,
      expandedDirectories: this.expandedDirectories,
      textEditorDocument: this.textEditorDocument,
      terminalSession: this.terminalSession,
      gitPanel: this.gitPanel,
      debugSession: this.debugSession,
      theme: this.themeState,
      panelWidthPx: this.panelWidthState,
      health: this.healthState,
    });
  }
}
