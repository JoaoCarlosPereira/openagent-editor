import { ProtocolError } from "@openagent/protocol";

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

  get current(): ElectronMainLaunchSnapshot | null {
    return this.snapshot;
  }

  get daemon(): OpenAgentEditorMainConnection | null {
    return this.daemonConnection;
  }

  launch(input: ElectronMainLaunchInput): ElectronMainLaunchSnapshot {
    const platform = assertSupportedPlatform(input.platform);
    const identity = createOpenAgentProductIdentity(input.repoRoot);
    this.daemonConnection = null;
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
    return connection;
  }

  closeDaemon(): void {
    this.daemonConnection?.client.close();
    this.daemonConnection = null;
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
