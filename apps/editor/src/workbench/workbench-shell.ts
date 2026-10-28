import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { ProtocolError } from "@openagent/protocol";

import {
  createOpenAgentProductIdentity,
  type ElectronProductIdentity,
} from "../main/product-identity.js";
import {
  buildWorkbenchShellView,
  type WorkbenchShellViewSnapshot,
} from "./workbench-shell-view.js";

export type { WorkbenchShellViewSnapshot, WorkbenchCapabilitySlot } from "./workbench-shell-view.js";
export {
  buildWorkbenchShellView,
  WORKBENCH_CAPABILITY_SLOTS,
} from "./workbench-shell-view.js";

export const WORKBENCH_FOLDER_REQUIRED_MESSAGE =
  "Caminho de pasta obrigatório para abrir o workbench OpenAgent.";
export const WORKBENCH_FOLDER_INVALID_MESSAGE =
  "Pasta inválida: o caminho não existe ou não é um diretório.";

export interface WorkbenchShellOpenInput {
  platform: string;
  folderPath?: unknown;
  repoRoot?: string;
}

export interface WorkbenchShellOpenResult {
  identity: ElectronProductIdentity;
  folderPath: string;
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
 * LOC-01 (118): workbench Electron — abrir pasta e expor slots (edição, terminal, Git, debug, extensão)
 * com nome e ícone OpenAgent. Capacidades concretas entram nas tasks 120+.
 */
export class WorkbenchShellController {
  private identity: ElectronProductIdentity = createOpenAgentProductIdentity();
  private folderPath: string | null = null;
  private platform = "linux";
  private view: WorkbenchShellViewSnapshot = buildWorkbenchShellView({
    identity: this.identity,
    folderPath: null,
    platform: this.platform,
  });

  get snapshot(): WorkbenchShellViewSnapshot {
    return this.view;
  }

  /** Inicializa o shell com identidade OpenAgent antes de abrir pasta. */
  bootstrap(input: { platform: string; repoRoot?: string }): WorkbenchShellViewSnapshot {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    this.folderPath = null;
    this.refreshView();
    return this.view;
  }

  openFolder(input: WorkbenchShellOpenInput): WorkbenchShellOpenResult {
    this.platform = input.platform;
    this.identity = createOpenAgentProductIdentity(input.repoRoot);
    const folderPath = assertFolderPath(input.folderPath);
    this.folderPath = folderPath;
    this.refreshView();
    return {
      identity: this.identity,
      folderPath,
      view: this.view,
    };
  }

  private refreshView(): void {
    this.view = buildWorkbenchShellView({
      identity: this.identity,
      folderPath: this.folderPath,
      platform: this.platform,
    });
  }
}
