import {
  OPENAGENT_ICON_RELATIVE_PATH,
  OPENAGENT_PRODUCT_NAME,
  type ElectronProductIdentity,
} from "../main/product-identity.js";
import type { FileTreeEntry } from "./file-tree.js";
import {
  buildFileTreeView,
  type FileTreeViewSnapshot,
} from "./file-tree-view.js";
import type { TextEditorDocument } from "./text-editor.js";
import {
  buildTextEditorView,
  type TextEditorViewSnapshot,
} from "./text-editor-view.js";
import type { IntegratedGitPanel } from "./git-panel.js";
import {
  buildGitPanelView,
  type GitPanelViewSnapshot,
} from "./git-panel-view.js";
import type { IntegratedTerminalSession } from "./terminal.js";
import {
  buildTerminalView,
  type TerminalViewSnapshot,
} from "./terminal-view.js";
import type { IntegratedDebugSession } from "./debug-session.js";
import {
  buildDebugView,
  type DebugViewSnapshot,
} from "./debug-view.js";
import {
  WORKBENCH_THEME_DEFAULT,
  type WorkbenchTheme,
  themeTokensCssVariables,
  WORKBENCH_PANEL_WIDTH_DEFAULT_PX,
} from "./theme.js";

export type WorkbenchCapabilitySlot =
  | "editor"
  | "terminal"
  | "git"
  | "debug"
  | "extension-host";

export const WORKBENCH_CAPABILITY_SLOTS: readonly WorkbenchCapabilitySlot[] = [
  "editor",
  "terminal",
  "git",
  "debug",
  "extension-host",
] as const;

export interface WorkbenchShellViewInput {
  identity: ElectronProductIdentity;
  folderPath: string | null;
  platform: string;
  /** Main ligado ao daemon (task_119); renderer permanece sem ferramentas. */
  daemonConnected?: boolean;
  toolsAllowedInRenderer?: false;
  /** Árvore de arquivos da pasta aberta (task_120). */
  fileTreeEntries?: readonly FileTreeEntry[];
  expandedDirectories?: readonly string[];
  /** Documento aberto no editor de texto (task_121). */
  textEditorDocument?: TextEditorDocument | null;
  /** Sessão do terminal integrado (task_122). */
  terminalSession?: IntegratedTerminalSession | null;
  /** Painel Git status/diff (task_123). */
  gitPanel?: IntegratedGitPanel | null;
  /** Sessão de depuração DAP (task_124). */
  debugSession?: IntegratedDebugSession | null;
  /** Tema claro/escuro (UI-02). */
  theme?: WorkbenchTheme;
  /** Largura do painel em px (UI-02). */
  panelWidthPx?: number;
}

export interface WorkbenchShellViewSnapshot {
  html: string;
  accessible: {
    productName: typeof OPENAGENT_PRODUCT_NAME;
    iconRelativePath: typeof OPENAGENT_ICON_RELATIVE_PATH;
    folderPath: string | null;
    capabilitySlots: readonly WorkbenchCapabilitySlot[];
    focusOrder: readonly string[];
    daemonConnected: boolean;
    toolsAllowedInRenderer: false;
    fileTree: FileTreeViewSnapshot["accessible"];
    textEditor: TextEditorViewSnapshot["accessible"];
    terminal: TerminalViewSnapshot["accessible"];
    git: GitPanelViewSnapshot["accessible"];
    debug: DebugViewSnapshot["accessible"];
    /** Tema ativo no workbench (UI-02). */
    theme: WorkbenchTheme;
    /** Largura do painel em px (UI-02). */
    panelWidthPx: number;
  };
  fileTree: FileTreeViewSnapshot;
  textEditor: TextEditorViewSnapshot;
  terminal: TerminalViewSnapshot;
  git: GitPanelViewSnapshot;
  debug: DebugViewSnapshot;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCapabilitySlot(
  slot: WorkbenchCapabilitySlot,
  textEditor: TextEditorViewSnapshot,
  terminal: TerminalViewSnapshot,
  git: GitPanelViewSnapshot,
  debug: DebugViewSnapshot,
): string {
  if (slot === "editor") {
    return textEditor.html;
  }
  if (slot === "terminal") {
    return terminal.html;
  }
  if (slot === "git") {
    return git.html;
  }
  if (slot === "debug") {
    return debug.html;
  }
  return [
    `<section data-testid="workbench-slot-${slot}" data-capability="${slot}"`,
    ` role="region" aria-label="${escapeHtml(slot)}" tabindex="0">`,
    `<h3>${escapeHtml(slot)}</h3>`,
    `</section>`,
  ].join("");
}

/** LOC-01: shell do workbench com identidade OpenAgent, slots, árvore, editor, terminal, Git e debug DAP. */
export function buildWorkbenchShellView(
  input: WorkbenchShellViewInput,
): WorkbenchShellViewSnapshot {
  const daemonConnected = input.daemonConnected === true;
  const toolsAllowedInRenderer = false as const;
  const fileTreeEntries = input.fileTreeEntries ?? [];
  const expandedDirectories = input.expandedDirectories ?? [];
  const textEditorDocument = input.textEditorDocument ?? null;
  const terminalSession = input.terminalSession ?? null;
  const gitPanel = input.gitPanel ?? null;
  const debugSession = input.debugSession ?? null;
  const theme = input.theme ?? WORKBENCH_THEME_DEFAULT;
  const panelWidthPx = input.panelWidthPx ?? WORKBENCH_PANEL_WIDTH_DEFAULT_PX;

  const fileTree = buildFileTreeView({
    folderPath: input.folderPath,
    entries: fileTreeEntries,
    expandedDirectories,
  });
  const textEditor = buildTextEditorView({ document: textEditorDocument });
  const terminal = buildTerminalView({ session: terminalSession });
  const git = buildGitPanelView({ panel: gitPanel });
  const debug = buildDebugView({ session: debugSession });

  const focusOrder = [
    "workbench-product-name",
    "workbench-product-icon",
    "workbench-folder",
    "workbench-file-tree",
    "workbench-daemon-link",
    "workbench-renderer-tools",
    "workbench-slot-editor",
    "workbench-slot-terminal",
    "workbench-slot-git",
    "workbench-slot-debug",
    ...WORKBENCH_CAPABILITY_SLOTS.filter(
      (slot) => slot !== "editor" && slot !== "terminal" && slot !== "git" && slot !== "debug",
    ).map((slot) => `workbench-slot-${slot}`),
  ] as const;

  const folderLabel = input.folderPath ?? "Nenhuma pasta aberta";
  const slotsHtml = WORKBENCH_CAPABILITY_SLOTS.map((slot) =>
    renderCapabilitySlot(slot, textEditor, terminal, git, debug),
  ).join("");
  const daemonLabel = daemonConnected
    ? "Main ligado ao harness-daemon"
    : "Main sem ligação ao daemon";
  const themeCssVars = themeTokensCssVariables(theme);

  const html = [
    `<main role="application" aria-label="${escapeHtml(input.identity.displayName)}"`,
    ` data-testid="workbench-shell" data-platform="${escapeHtml(input.platform)}"`,
    ` data-daemon-connected="${daemonConnected ? "true" : "false"}"`,
    ` data-tools-allowed-in-renderer="false"`,
    ` data-folder-open="${input.folderPath !== null ? "true" : "false"}"`,
    ` data-theme="${theme}"`,
    ` data-panel-width="${panelWidthPx}"`,
    ` style="background:var(--workbench-bg);color:var(--workbench-fg);border-color:var(--workbench-border);${themeCssVars};">`,
    `<header data-testid="workbench-branding">`,
    `<img data-testid="workbench-product-icon" src="${escapeHtml(input.identity.iconRelativePath)}"`,
    ` alt="${escapeHtml(OPENAGENT_PRODUCT_NAME)}" tabindex="0" />`,
    `<h1 id="workbench-product-name" data-testid="workbench-product-name" tabindex="0">`,
    `${escapeHtml(OPENAGENT_PRODUCT_NAME)}</h1>`,
    `</header>`,
    `<p data-testid="workbench-folder" aria-live="polite" tabindex="0">`,
    `${escapeHtml(folderLabel)}</p>`,
    fileTree.html,
    `<p data-testid="workbench-daemon-link" aria-live="polite" tabindex="0"`,
    ` data-connected="${daemonConnected ? "true" : "false"}">`,
    `${escapeHtml(daemonLabel)}</p>`,
    `<p data-testid="workbench-renderer-tools" aria-live="polite" tabindex="0"`,
    ` data-tools-allowed="false">Renderer sem ferramentas</p>`,
    `<div data-testid="workbench-capabilities">${slotsHtml}</div>`,
    `</main>`,
  ].join("");

  return {
    html,
    accessible: {
      productName: OPENAGENT_PRODUCT_NAME,
      iconRelativePath: OPENAGENT_ICON_RELATIVE_PATH,
      folderPath: input.folderPath,
      capabilitySlots: WORKBENCH_CAPABILITY_SLOTS,
      focusOrder,
      daemonConnected,
      toolsAllowedInRenderer,
      fileTree: fileTree.accessible,
      textEditor: textEditor.accessible,
      terminal: terminal.accessible,
      git: git.accessible,
      debug: debug.accessible,
      theme,
      panelWidthPx,
    },
    fileTree,
    textEditor,
    terminal,
    git,
    debug,
  };
}
