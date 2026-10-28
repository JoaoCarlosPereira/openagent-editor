import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

/**
 * Versão congelada do contrato da API de extensões (ADR-007 / Cursor 3.24.18).
 */
export const FROZEN_EXTENSION_API_VERSION = "3.24.18" as const;

export interface ExtensionManifestContributionCommand {
  command: string;
  title: string;
  category?: string;
}

export interface ExtensionManifestContributions {
  commands?: ExtensionManifestContributionCommand[];
  configuration?: {
    title?: string;
    properties?: Record<string, unknown>;
  };
}

export interface ExtensionManifest {
  name: string;
  publisher: string;
  version: string;
  displayName?: string;
  description?: string;
  main?: string;
  activationEvents?: string[];
  contributes?: ExtensionManifestContributions;
  engines?: {
    vscode?: string;
    openagent?: string;
  };
}

export interface Disposable {
  dispose(): void;
}

export interface ExtensionMemento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

export interface ExtensionOutputChannel extends Disposable {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  getContent(): string;
}

export interface ExtensionCommandsApi {
  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown,
    thisArg?: unknown,
  ): Disposable;
  executeCommand<T = unknown>(command: string, ...rest: unknown[]): Promise<T>;
  getCommands(filterInternal?: boolean): Promise<string[]>;
}

export interface ExtensionWindowApi {
  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
  createOutputChannel(name: string): ExtensionOutputChannel;
}

export interface ExtensionWorkspaceConfiguration {
  get<T>(section: string): T | undefined;
  get<T>(section: string, defaultValue: T): T;
  has(section: string): boolean;
  update(section: string, value: unknown): Promise<void>;
}

export interface ExtensionWorkspaceApi {
  readonly rootPath: string | undefined;
  readonly name: string | undefined;
  getConfiguration(section?: string): ExtensionWorkspaceConfiguration;
}

export interface ExtensionContext {
  readonly extensionId: string;
  readonly extensionPath: string;
  readonly globalState: ExtensionMemento;
  readonly workspaceState: ExtensionMemento;
  readonly subscriptions: Disposable[];
}

export interface OpenAgentExtensionApi {
  readonly version: typeof FROZEN_EXTENSION_API_VERSION;
  readonly commands: ExtensionCommandsApi;
  readonly window: ExtensionWindowApi;
  readonly workspace: ExtensionWorkspaceApi;
}

export interface ExtensionModule {
  activate?(context: ExtensionContext): Promise<unknown> | unknown;
  deactivate?(): Promise<void> | void;
}

export function validateExtensionManifest(candidate: unknown): {
  valid: boolean;
  manifest?: ExtensionManifest;
  error?: ProtocolError;
} {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      valid: false,
      error: new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Manifesto de extensão inválido: objeto esperado.",
      ),
    };
  }

  const raw = candidate as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const publisher = typeof raw.publisher === "string" ? raw.publisher.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "";

  if (!name || !publisher || !version) {
    return {
      valid: false,
      error: new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Manifesto inválido: 'name', 'publisher' e 'version' são obrigatórios.",
      ),
    };
  }

  const activationEvents = Array.isArray(raw.activationEvents)
    ? raw.activationEvents.filter((item): item is string => typeof item === "string")
    : undefined;

  const manifest: ExtensionManifest = {
    name,
    publisher,
    version,
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    main: typeof raw.main === "string" ? raw.main : undefined,
    activationEvents,
    contributes: typeof raw.contributes === "object" && raw.contributes !== null
      ? (raw.contributes as ExtensionManifestContributions)
      : undefined,
  };

  return { valid: true, manifest };
}

export function formatExtensionIdentifier(publisher: string, name: string): string {
  return `${publisher.trim()}.${name.trim()}`.toLowerCase();
}
