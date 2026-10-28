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

export const WORKBENCH_FOLDER_REQUIRED_MESSAGE =
  "Caminho de pasta obrigatório para abrir o workbench OpenAgent.";
export const WORKBENCH_FOLDER_INVALID_MESSAGE =
  "Pasta inválida: o caminho não existe ou não é um diretório.";
export const WORKBENCH_FOLDER_NOT_OPEN_MESSAGE =
  "Nenhuma pasta aberta no workbench para expandir a árvore.";

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

/**
 * LOC-01: workbench Electron — slots, main↔daemon, árvore de arquivos (task_120).
 * Capacidades concretas seguintes (editor de texto, terminal, …) entram nas tasks 121+.
 */
export class WorkbenchShellController {
  private identity: ElectronProductIdentity = createOpenAgentProductIdentity();
  private folderPath: string | null = null;
  private platform = "linux";
  private daemonConnected = false;
  private fileTreeEntries: FileTreeEntry[] = [];
  private expandedDirectories: string[] = [];
  private readonly rendererBridge: RendererToolBridge = createRendererToolBridge();
  private view: WorkbenchShellViewSnapshot = buildWorkbenchShellView({
    identity: this.identity,
    folderPath: null,
    platform: this.platform,
    daemonConnected: false,
    toolsAllowedInRenderer: false,
    fileTreeEntries: [],
    expandedDirectories: [],
  });

  get snapshot(): WorkbenchShellViewSnapshot {
    return this.view;
  }

  /** Ponte do renderer: nunca permite tool.invoke (LOC-01 / ADR-003). */
  get rendererTools(): RendererToolBridge {
    return this.rendererBridge;
  }

  /** Inicializa o shell com identidade OpenAgent antes de abrir pasta. */
  bootstrap(input: { platform: string; repoRoot?: string }): WorkbenchShellViewSnapshot {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    this.folderPath = null;
    this.daemonConnected = false;
    this.fileTreeEntries = [];
    this.expandedDirectories = [];
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
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    const folderPath = assertFolderPath(input.folderPath);
    this.folderPath = folderPath;
    this.expandedDirectories = [];
    this.fileTreeEntries = collectVisibleEntries(folderPath, this.expandedDirectories);
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

  private refreshView(): void {
    this.view = buildWorkbenchShellView({
      identity: this.identity,
      folderPath: this.folderPath,
      platform: this.platform,
      daemonConnected: this.daemonConnected,
      toolsAllowedInRenderer: false,
      fileTreeEntries: this.fileTreeEntries,
      expandedDirectories: this.expandedDirectories,
    });
  }
}
