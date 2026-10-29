import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import type { DocumentSelector, CompletionItemProvider, HoverProvider } from "./frozen-surface.js";

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
  icon?: string;
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

export interface ExtensionLanguagesApi {
  registerCompletionItemProvider(
    selector: DocumentSelector,
    provider: CompletionItemProvider,
    ...triggerCharacters: string[]
  ): Disposable;
  registerCompletionProvider(
    selector: DocumentSelector,
    provider: CompletionItemProvider,
    ...triggerCharacters: string[]
  ): Disposable;
  registerHoverProvider(
    selector: DocumentSelector,
    provider: HoverProvider
  ): Disposable;
}

export interface OpenAgentExtensionApi {
  readonly version: typeof FROZEN_EXTENSION_API_VERSION;
  readonly commands: ExtensionCommandsApi;
  readonly window: ExtensionWindowApi;
  readonly workspace: ExtensionWorkspaceApi;
  readonly languages: ExtensionLanguagesApi;
}

export interface ExtensionModule {
  activate?(context: ExtensionContext): Promise<unknown> | unknown;
  deactivate?(): Promise<void> | void;
}

export interface ValidateExtensionManifestOptions {
  requireEngines?: boolean;
  requireMain?: boolean;
}

export function validateExtensionManifest(
  candidate: unknown,
  options?: ValidateExtensionManifestOptions,
): {
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
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const invalidField = (field: string) => ({
    valid: false,
    error: new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, `Manifesto inválido: '${field}' possui formato inválido.`),
  });
  for (const field of ["displayName", "description", "icon", "main"] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") return invalidField(field);
  }
  if (raw.activationEvents !== undefined &&
      (!Array.isArray(raw.activationEvents) || raw.activationEvents.some((event) => typeof event !== "string"))) {
    return invalidField("activationEvents");
  }
  if (raw.engines !== undefined && (!isObject(raw.engines) ||
      ["vscode", "openagent"].some((key) => raw.engines !== undefined &&
        isObject(raw.engines) && raw.engines[key] !== undefined && typeof raw.engines[key] !== "string"))) {
    return invalidField("engines");
  }
  if (raw.contributes !== undefined) {
    if (!isObject(raw.contributes)) return invalidField("contributes");
    const commands = raw.contributes.commands;
    if (commands !== undefined && (!Array.isArray(commands) ||
        commands.some((entry) => !isObject(entry) || typeof entry.command !== "string" || !entry.command.trim()))) {
      return invalidField("contributes.commands");
    }
  }
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

  const enginesRaw =
    typeof raw.engines === "object" && raw.engines !== null
      ? (raw.engines as Record<string, unknown>)
      : undefined;
  const engines = enginesRaw
    ? {
        vscode:
          typeof enginesRaw.vscode === "string" && enginesRaw.vscode.trim()
            ? enginesRaw.vscode.trim()
            : undefined,
        openagent:
          typeof enginesRaw.openagent === "string" && enginesRaw.openagent.trim()
            ? enginesRaw.openagent.trim()
            : undefined,
      }
    : undefined;

  if (options?.requireEngines) {
    if (!engines || (!engines.vscode && !engines.openagent)) {
      return {
        valid: false,
        error: new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Manifesto inválido: 'engines' deve especificar compatibilidade com 'vscode' ou 'openagent'.",
        ),
      };
    }
  }

  const main = typeof raw.main === "string" && raw.main.trim() ? raw.main.trim() : undefined;
  if (raw.main !== undefined && !main) return invalidField("main");
  if (main?.includes("\0")) {
    return {
      valid: false,
      error: new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Manifesto inválido: 'main' contém caractere nulo."),
    };
  }
  if (options?.requireMain && !main) {
    return {
      valid: false,
      error: new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Manifesto inválido: campo 'main' é obrigatório.",
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
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    main,
    activationEvents,
    contributes:
      typeof raw.contributes === "object" && raw.contributes !== null
        ? (raw.contributes as ExtensionManifestContributions)
        : undefined,
    engines,
  };

  return { valid: true, manifest };
}

export function validateVsixManifest(
  candidate: unknown,
  options?: ValidateExtensionManifestOptions,
): {
  valid: boolean;
  manifest?: ExtensionManifest;
  error?: ProtocolError;
} {
  const result = validateExtensionManifest(candidate, {
    requireEngines: options?.requireEngines ?? true,
    requireMain: options?.requireMain ?? false,
  });
  if (result.manifest && (!/^[a-z0-9][a-z0-9-]*$/i.test(result.manifest.name) ||
      !/^[a-z0-9][a-z0-9-]*$/i.test(result.manifest.publisher) ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(result.manifest.version))) {
    return { valid: false, error: new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Identidade ou versão da extensão inválida.") };
  }
  return result;
}

export function formatExtensionIdentifier(publisher: string, name: string): string {
  return `${publisher.trim()}.${name.trim()}`.toLowerCase();
}

// ─── Superfície congelada declarativa (task_158) ────────────────────────────────
// FROZEN_EXTENSION_API_VERSION já é exportada acima (mesmo valor "3.24.18").
export {
  type FrozenVersion,
  createFrozenSurface,
  createCommandsNamespace,
  createWindowNamespace,
  createWorkspaceNamespace,
  createLanguagesNamespace,
  EXPECTED_SURFACE_KEYS,
  EXPECTED_SURFACE_TYPES,
  type FrozenExtensionApiSurface,
  type CommandEntry,
  type CommandRegistration,
  type CommandsNamespace,
  type StatusBarItem,
  type WindowNamespace,
  type TextDocumentData,
  type TextEditorDecorationType,
  type WorkspaceFile,
  type WorkspaceNamespace,
  type Position,
  type Range,
  type DocumentFilter,
  type DocumentSelector,
  type CompletionItem,
  type CompletionList,
  type CompletionContext,
  type CompletionItemProvider,
  type Hover,
  type HoverProvider,
  type SignatureHelp,
  type SignatureInfo,
  type SignatureParameterInfo,
  type HoverContents,
  type DefinitionLocation,
  type CodeActionKind,
  type CodeActionContext,
  type CodeAction,
  type DiagnosticSeverityCodes,
  type Diagnostic,
  type LanguagesNamespace,
  type EnvironmentNamespace,
  type MementoData,
  type OutputChannel,
  type OutputNamespace,
  type WorkspaceAdapter,
  type WindowAdapter,
} from "./frozen-surface.js";

export { matchDocumentSelector, type RegisteredCompletionProvider, type RegisteredHoverProvider } from "./namespace-impl.js";

export {
  validateFrozenSurface,
  isFrozenSurfaceValid,
  type ValidationIssue,
  type ValidationResult,
  ValidationError,
} from "./validator.js";
