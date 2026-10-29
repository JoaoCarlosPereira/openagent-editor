import type { ExtensionManifest } from "@openagent/extension-api";
import type { ProtocolErrorCode } from "@openagent/protocol";

export type ExtensionLifecycleState =
  | "unloaded"
  | "loading"
  | "active"
  | "deactivating"
  | "deactivated"
  | "failed";

export interface ExtensionRegistration {
  readonly id: string;
  readonly extensionPath: string;
  readonly manifest: ExtensionManifest;
  readonly mainAbsolutePath: string;
  state: ExtensionLifecycleState;
  activatedAt?: number;
  deactivatedAt?: number;
  lastError?: string;
  registeredCommands: string[];
}

export interface ExtensionHostConfig {
  readonly workspaceRoot: string;
  readonly extensionsDirectory: string;
  readonly storageDirectory?: string;
}

export type ExtensionWorkerRequest =
  | { kind: "init"; requestId: string; config: ExtensionHostConfig }
  | {
      kind: "activate";
      requestId: string;
      extensionId: string;
      mainAbsolutePath: string;
      extensionPath: string;
      manifest: ExtensionManifest;
    }
  | {
      kind: "executeCommand";
      requestId: string;
      extensionId: string;
      command: string;
      args: unknown[];
    }
  | { kind: "deactivate"; requestId: string; extensionId: string }
  | { kind: "ping"; requestId: string }
  | {
      kind: "provideCompletionItems";
      requestId: string;
      extensionId: string;
      providerId?: string;
      document: { uri: string; version?: number; lineCount?: number; text?: string };
      position: { line: number; character: number };
      context?: unknown;
    }
  | {
      kind: "resolveCompletionItem";
      requestId: string;
      extensionId: string;
      providerId?: string;
      item: unknown;
    }
  | {
      kind: "provideHover";
      requestId: string;
      extensionId: string;
      providerId?: string;
      document: { uri: string; version?: number; lineCount?: number; text?: string };
      position: { line: number; character: number };
    };

export type ExtensionWorkerRequestPayload =
  | { kind: "init"; config: ExtensionHostConfig }
  | {
      kind: "activate";
      extensionId: string;
      mainAbsolutePath: string;
      extensionPath: string;
      manifest: ExtensionManifest;
    }
  | {
      kind: "executeCommand";
      extensionId: string;
      command: string;
      args: unknown[];
    }
  | { kind: "deactivate"; extensionId: string }
  | { kind: "ping" }
  | {
      kind: "provideCompletionItems";
      extensionId: string;
      providerId?: string;
      document: { uri: string; version?: number; lineCount?: number; text?: string };
      position: { line: number; character: number };
      context?: unknown;
    }
  | {
      kind: "resolveCompletionItem";
      extensionId: string;
      providerId?: string;
      item: unknown;
    }
  | {
      kind: "provideHover";
      extensionId: string;
      providerId?: string;
      document: { uri: string; version?: number; lineCount?: number; text?: string };
      position: { line: number; character: number };
    };

export type ExtensionWorkerResponse =
  | {
      kind: "editorRequest";
      requestId: string;
      extensionId: string;
      operation: string;
      args: unknown[];
    }
  | {
      kind: "result";
      requestId: string;
      output: unknown;
    }
  | {
      kind: "error";
      requestId: string;
      code: ProtocolErrorCode;
      message: string;
      details?: string[];
    }
  | {
      kind: "event";
      eventType:
        | "commandRegistered"
        | "outputAppended"
        | "messageShown"
        | "completionProviderRegistered"
        | "completionProviderUnregistered"
        | "hoverProviderRegistered"
        | "hoverProviderUnregistered"
        | string;
      payload: unknown;
    };

export interface RegisteredCompletionProviderInfo {
  extensionId: string;
  providerId: string;
  selector: unknown;
  triggerCharacters?: string[];
}

export interface RegisteredHoverProviderInfo {
  extensionId: string;
  providerId: string;
  selector: unknown;
}
