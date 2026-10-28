/**
 * Tipos e contratos da ferramenta browser CDP em target isolado (AUT-01).
 */

export interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpTransport {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  on(
    event: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void;
  close(): Promise<void>;
  isClosed(): boolean;
}

export interface BrowserTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
}

export interface BrowserTargetSession {
  targetId: string;
  sessionId: string;
  browserContextId: string;
  url: string;
}

export interface BrowserConsoleLogEntry {
  type: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  timestamp: number;
  args?: unknown[];
}

export type BrowserInteraction =
  | { type: "evaluate"; expression: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "none" };

export interface BrowserUrlPolicyOptions {
  workspaceRoot?: string;
  allowedUrlPrefixes?: readonly string[];
  allowedOrigins?: readonly string[];
  allowedSchemes?: readonly string[];
}

export interface OpenAuthorizedBrowserUrlInput {
  url: unknown;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  interaction?: BrowserInteraction;
  timeoutMs?: number;
}

export interface BrowserCdpToolResult {
  capability: "browser.open";
  tool: "browser.open";
  url: string;
  targetId: string;
  browserContextId: string;
  sessionId: string;
  title: string;
  screenshot: string;
  screenshotMimeType: "image/png";
  consoleLogs: readonly BrowserConsoleLogEntry[];
  interactionResult?: unknown;
}
