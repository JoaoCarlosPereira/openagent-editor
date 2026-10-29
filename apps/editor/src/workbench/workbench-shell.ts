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
  buildWorkbenchShellView,
  type WorkbenchShellViewSnapshot,
} from "./workbench-shell-view.js";

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

export const WORKBENCH_FOLDER_REQUIRED_MESSAGE =
  "Caminho de pasta obrigatório para abrir o workbench OpenAgent.";
export const WORKBENCH_FOLDER_INVALID_MESSAGE =
  "Pasta inválida: o caminho não existe ou não é um diretório.";
export const WORKBENCH_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para expandir a árvore.";
export const WORKBENCH_TEXT_EDITOR_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para editar arquivos.";

export interface WorkbenchShellOpenInput {
  platform: string;
  folderPath?: unknown;
  repoRoot?: string;
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
 * LOC-01: workbench Electron — slots, árvore (120) e editor de texto (121).
 */
export class WorkbenchShellController {
  private identity: ElectronProductIdentity = createOpenAgentProductIdentity();
  private folderPath: string | null = null;
  private platform = "linux";
  private daemonConnected = false;
  private fileTreeEntries: FileTreeEntry[] = [];
  private expandedDirectories: string[] = [];
  private textEditorDocument: TextEditorDocument | null = null;
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
  });

  get snapshot(): WorkbenchShellViewSnapshot {
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

  get visibleEntries(): readonly FileTreeEntry[] {
    return this.fileTreeEntries;
  }

  /** Inicializa o shell com identidade OpenAgent antes de abrir pasta. */
  bootstrap(input: { platform: string; repoRoot?: string }): WorkbenchShellViewSnapshot {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    this.folderPath = null;
    this.daemonConnected = false;
    this.fileTreeEntries = [];
    this.expandedDirectories = [];
    this.textEditorDocument = null;
    this.refreshView();
    return this.view;
  }

  /** Reflete no shell que o processo main está ligado ao harness-daemon. */
  setDaemonConnected(connected: boolean): WorkbenchShellViewSnapshot {
    this.daemonConnected = connected;
    this.refreshView();
    return this.view;
  }

  openFolder(input: WorkbenchShellOpenInput): WorkbenchShellOpenResult {
    const identity = createOpenAgentProductIdentity(input.repoRoot);
    const folderPath = assertFolderPath(input.folderPath);
    const fileTreeEntries = collectVisibleEntries(folderPath, []);
    this.platform = input.platform;
    this.identity = identity;
    this.folderPath = folderPath;
    this.expandedDirectories = [];
    this.fileTreeEntries = fileTreeEntries;
    this.textEditorDocument = null;
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
    const expandedDirectories = this.expandedDirectories.includes(relative)
      ? this.expandedDirectories
      : [...this.expandedDirectories, relative];
    const fileTreeEntries = collectVisibleEntries(this.folderPath, expandedDirectories);
    this.expandedDirectories = expandedDirectories;
    this.fileTreeEntries = fileTreeEntries;
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
    });
  }
}
