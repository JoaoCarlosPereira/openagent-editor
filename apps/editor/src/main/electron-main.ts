import { ProtocolError } from "@openagent/protocol";

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

export const ELECTRON_MAIN_INVALID_PLATFORM_MESSAGE =
  "Plataforma de empacotamento inválida para o editor OpenAgent.";

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
 * LOC-01 (118): processo main Electron com nome e ícone OpenAgent.
 * Sem dependência do binário Electron — produz o contrato observável do shell.
 */
export class ElectronMainController {
  private snapshot: ElectronMainLaunchSnapshot | null = null;

  get current(): ElectronMainLaunchSnapshot | null {
    return this.snapshot;
  }

  launch(input: ElectronMainLaunchInput): ElectronMainLaunchSnapshot {
    const platform = assertSupportedPlatform(input.platform);
    const identity = createOpenAgentProductIdentity(input.repoRoot);
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
    };
    return this.snapshot;
  }
}
