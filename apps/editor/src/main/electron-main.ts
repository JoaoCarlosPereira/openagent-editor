import { ProtocolError } from "@openagent/protocol";

import {
  WorkbenchShellController,
  type WorkbenchShellViewSnapshot,
  type WorkbenchDebugResult,
  type WorkbenchGitPanelResult,
  type WorkbenchShellOpenResult,
  type WorkbenchTerminalResult,
  type WorkbenchTextEditorResult,
} from "../workbench/workbench-shell.js";
import type {
  WorkbenchHealthSnapshot,
} from "../workbench/health-indicator.js";
import {
  connectOpenAgentEditorMain,
  type OpenAgentEditorMainConnectInput,
  type OpenAgentEditorMainConnection,
} from "./connect-main-daemon.js";
import {
  createOpenAgentProductIdentity,
  type ElectronProductIdentity,
  OPENAGENT_PRODUCT_NAME,
} from "./product-identity.js";

export type { ElectronProductIdentity } from "./product-identity.js";
export {
  OPENAGENT_PRODUCT_NAME,
  OPENAGENT_PRODUCT_DISPLAY_NAME,
  OPENAGENT_ICON_RELATIVE_PATH,
  resolveOpenAgentIconPath,
  createOpenAgentProductIdentity,
} from "./product-identity.js";
export {
  connectOpenAgentEditorMain,
  OPENAGENT_EDITOR_MAIN_CLIENT_ID,
  EDITOR_MAIN_HELLO_INVALID_MESSAGE,
  type OpenAgentEditorMainConnectInput,
  type OpenAgentEditorMainConnection,
} from "./connect-main-daemon.js";

export const ELECTRON_MAIN_INVALID_PLATFORM_MESSAGE =
  "Plataforma de empacotamento inválida para o editor OpenAgent.";

export const ELECTRON_MAIN_DAEMON_REQUIRED_MESSAGE =
  "Processo main precisa estar lançado antes de conectar ao harness-daemon.";

export const ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE =
  "Processo main precisa estar lançado antes de abrir uma pasta no workbench.";

export type OpenAgentSupportedPlatform = "linux" | "win32" | "darwin";

const SUPPORTED_PLATFORMS = new Set<OpenAgentSupportedPlatform>([
  "linux",
  "win32",
  "darwin",
]);

export interface ElectronBrowserWindowOptions {
  title: string;
  icon: string;
  show: boolean;
  webPreferences: {
    nodeIntegration: false;
    contextIsolation: true;
    sandbox: true;
  };
}

export interface ElectronMainLaunchInput {
  platform: unknown;
  repoRoot?: string;
}

export interface ElectronMainLaunchSnapshot {
  identity: ElectronProductIdentity;
  platform: OpenAgentSupportedPlatform;
  browserWindow: ElectronBrowserWindowOptions;
  /** Opções que o processo main passaria ao Electron (sem acoplar ao binário). */
  app: {
    name: typeof OPENAGENT_PRODUCT_NAME;
    nameAsOpenAgent: true;
  };
  /** Main detém o cliente do daemon; renderer permanece sem ferramentas. */
  daemon: {
    connected: boolean;
    toolsAllowedInRenderer: false;
  };
}

function assertSupportedPlatform(platform: unknown): OpenAgentSupportedPlatform {
  if (typeof platform !== "string" || !SUPPORTED_PLATFORMS.has(platform as OpenAgentSupportedPlatform)) {
    throw new ProtocolError(
      "INVALID_STATE",
      ELECTRON_MAIN_INVALID_PLATFORM_MESSAGE,
      [`platform=${String(platform)}`],
    );
  }
  return platform as OpenAgentSupportedPlatform;
}

/**
 * LOC-01: processo main Electron com nome/ícone OpenAgent e ligação ao harness-daemon.
 * Sem dependência do binário Electron — produz o contrato observável do shell.
 * Ferramentas ficam no main→daemon; o renderer não recebe HarnessClient (task_119).
 */
export class ElectronMainController {
  private snapshot: ElectronMainLaunchSnapshot | null = null;
  private daemonConnection: OpenAgentEditorMainConnection | null = null;
  private readonly workbench = new WorkbenchShellController();
  private repoRoot: string | undefined;

  get current(): ElectronMainLaunchSnapshot | null {
    return this.snapshot;
  }

  get daemon(): OpenAgentEditorMainConnection | null {
    return this.daemonConnection;
  }

  /** Shell do workbench gerenciado pelo processo main (árvore no main, não no renderer). */
  get shell(): WorkbenchShellController {
    return this.workbench;
  }

  get health(): WorkbenchHealthSnapshot {
    return this.workbench.health;
  }

  setSubsystemHealth(
    subsystem: unknown,
    status: unknown,
    message: unknown,
  ): WorkbenchShellViewSnapshot {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.setSubsystemHealth(subsystem, status, message);
  }

  launch(input: ElectronMainLaunchInput): ElectronMainLaunchSnapshot {
    const platform = assertSupportedPlatform(input.platform);
    const identity = createOpenAgentProductIdentity(input.repoRoot);
    this.repoRoot = input.repoRoot;
    this.daemonConnection = null;
    this.workbench.bootstrap({ platform, repoRoot: input.repoRoot });
    this.snapshot = {
      identity,
      platform,
      browserWindow: {
        title: identity.displayName,
        icon: identity.iconPath,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      },
      app: {
        name: OPENAGENT_PRODUCT_NAME,
        nameAsOpenAgent: true,
      },
      daemon: {
        connected: false,
        toolsAllowedInRenderer: false,
      },
    };
    return this.snapshot;
  }

  /**
   * Abre pasta pelo processo main e monta a árvore de arquivos (LOC-01 / task_120).
   * A listagem roda no main; o renderer só consome o snapshot.
   */
  openFolder(folderPath: unknown): WorkbenchShellOpenResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.openFolder({
      platform: this.snapshot.platform,
      folderPath,
      repoRoot: this.repoRoot,
    });
  }

  /**
   * Abre arquivo de texto no editor pelo processo main (LOC-01 / task_121).
   * I/O no main; o renderer só consome o snapshot.
   */
  openTextFile(relativePath: unknown): WorkbenchTextEditorResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.openTextFile(relativePath);
  }

  /** Edita o buffer do documento aberto (main; sem gravar disco). */
  editTextDocument(content: unknown): WorkbenchTextEditorResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.editTextDocument(content);
  }

  /** Salva o documento aberto no disco sob a pasta (main). */
  saveTextDocument(): WorkbenchTextEditorResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.saveTextDocument();
  }

  /**
   * Abre o terminal integrado pelo processo main (LOC-01 / task_122).
   * Spawn/CWD no main; o renderer só consome o snapshot.
   */
  openTerminal(): WorkbenchTerminalResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.openTerminal();
  }

  /** Executa comando no terminal aberto (main). */
  runTerminalCommand(command: unknown): WorkbenchTerminalResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.runTerminalCommand(command);
  }

  /** Altera CWD relativo do terminal sob a pasta (main). */
  setTerminalCwd(relativeDirectory: unknown): WorkbenchTerminalResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.setTerminalCwd(relativeDirectory);
  }

  /**
   * Abre o painel Git pelo processo main (LOC-01 / task_123).
   * Status/diff no main; o renderer só consome o snapshot.
   */
  openGit(): WorkbenchGitPanelResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.openGit();
  }

  /** Atualiza status Git do painel aberto (main). */
  refreshGitStatus(): WorkbenchGitPanelResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.refreshGitStatus();
  }

  /** Carrega git diff no painel (main; caminho relativo confinado). */
  loadGitDiff(relativePath?: unknown): WorkbenchGitPanelResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.loadGitDiff(relativePath);
  }

  /**
   * Abre uma sessão de depuração DAP pelo processo main (LOC-01 / task_124).
   * Controle de sessão no main; o renderer consome o snapshot observável.
   */
  openDebug(targetPath: unknown): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.openDebug(targetPath);
  }

  /** Inicia a sessão de depuração DAP aberta (main). */
  startDebug(): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.startDebug();
  }

  /** Encerra a sessão de depuração DAP aberta (main). */
  stopDebug(): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.stopDebug();
  }

  /** Adiciona um breakpoint na sessão de depuração DAP aberta (main). */
  setDebugBreakpoint(relativePath: unknown, line: unknown): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.setDebugBreakpoint(relativePath, line);
  }

  /** Remove um breakpoint na sessão de depuração DAP aberta (main). */
  removeDebugBreakpoint(breakpointId: unknown): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.removeDebugBreakpoint(breakpointId);
  }

  /** Continua a execução da sessão de depuração DAP até breakpoint (main). */
  continueDebug(): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.continueDebug();
  }

  /** Avança uma linha (step over) na sessão de depuração DAP (main). */
  stepOverDebug(): WorkbenchDebugResult {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_FOLDER_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    return this.workbench.stepOverDebug();
  }

  /** Liga o processo main ao harness-daemon (ADR-003). */
  async connectDaemon(
    input: OpenAgentEditorMainConnectInput,
  ): Promise<OpenAgentEditorMainConnection> {
    if (this.snapshot === null) {
      throw new ProtocolError("INVALID_STATE", ELECTRON_MAIN_DAEMON_REQUIRED_MESSAGE, [
        "launch() não foi chamado",
      ]);
    }
    const connection = await connectOpenAgentEditorMain(input);
    this.daemonConnection = connection;
    this.snapshot = {
      ...this.snapshot,
      daemon: {
        connected: true,
        toolsAllowedInRenderer: false,
      },
    };
    this.workbench.setDaemonConnected(true);
    return connection;
  }

  closeDaemon(): void {
    this.daemonConnection?.client.close();
    this.daemonConnection = null;
    this.workbench.setDaemonConnected(false);
    if (this.snapshot !== null) {
      this.snapshot = {
        ...this.snapshot,
        daemon: {
          connected: false,
          toolsAllowedInRenderer: false,
        },
      };
    }
  }
}
