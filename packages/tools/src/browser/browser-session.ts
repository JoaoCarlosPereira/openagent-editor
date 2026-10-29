import { RunToolPermissionFlow, assertCapabilityAllowedForAgentMode } from "@openagent/policy";
import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";
import { prepareSandboxToolDispatch } from "../sandbox/tool-sandbox-dispatch.js";
import { validateBrowserUrl } from "./browser-url-policy.js";
import { CdpTargetManager } from "./cdp-target-manager.js";
import type { BrowserConsoleLogEntry, BrowserTargetSession } from "./types.js";
import type { PolicyBrowserToolContext } from "./policy-browser-tools.js";

type Action =
  | { type: "open"; url: string }
  | { type: "click"; targetId: string; url: string; selector: string };

export interface BrowserSessionEvidence {
  runId: string;
  targetId: string;
  url: string;
  action: Action;
  screenshot: string;
  screenshotMimeType: "image/png";
  consoleLogs: readonly BrowserConsoleLogEntry[];
}

/**
 * Um controlador pertence a uma única run e a um transporte CDP exclusivo.
 * A integração chamadora deve garantir o isolamento do worker e encerrar a sessão.
 */
export class AuthorizedBrowserSession {
  private readonly flow = new RunToolPermissionFlow();
  private readonly pending = new Map<string, Action>();
  private readonly used = new Set<string>();
  private readonly logs: BrowserConsoleLogEntry[] = [];
  private readonly evidence: BrowserSessionEvidence[] = [];
  private readonly manager: CdpTargetManager;
  private readonly offConsole: () => void;
  private target?: BrowserTargetSession;
  private closed = false;
  private busy = false;
  private readonly cancelListeners = new Set<() => void>();
  private readonly offRequests: () => void;
  private allowedNavigation?: string;
  private blockedNavigation = false;

  constructor(
    private readonly runId: string,
    private readonly sessionId: string,
    private readonly context: PolicyBrowserToolContext,
    manager: CdpTargetManager,
  ) {
    if (!runId.trim() || !sessionId.trim()) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Contexto de execução inválido.");
    }
    this.manager = manager;
    this.offRequests = manager.getTransport().on("Fetch.requestPaused", (params, sessionId) => {
      if (sessionId !== this.target?.sessionId) return;
      const request = params["request"] as { url?: unknown } | undefined;
      const requestId = params["requestId"];
      if (typeof requestId !== "string") return;
      const allowed = !this.closed && request?.url === this.allowedNavigation;
      if (!allowed) this.blockedNavigation = true;
      void manager.getTransport().send(
        allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
        allowed ? { requestId } : { requestId, errorReason: "BlockedByClient" },
        sessionId,
      ).catch(() => {});
    });
    this.offConsole = manager.getTransport().on("Runtime.consoleAPICalled", (params, sessionId) => {
      if (!this.closed && sessionId === this.target?.sessionId) {
        const args = Array.isArray(params["args"]) ? params["args"] : [];
        const first = args[0] as { value?: unknown } | undefined;
        this.logs.push({
          type: (params["type"] as BrowserConsoleLogEntry["type"]) ?? "log",
          text: String(first?.value ?? ""),
          timestamp: typeof params["timestamp"] === "number" ? params["timestamp"] : Date.now(),
          args,
        });
      }
    });
  }

  prepare(requestId: string, action: Action) {
    this.assertAvailable();
    if (!requestId.trim() || this.used.has(requestId)) {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Identificador de permissão inválido ou reutilizado.");
    }
    assertCapabilityAllowedForAgentMode(this.context.agentMode, "browser.open");
    const url = validateBrowserUrl(action.url, this.context);
    let normalized: Action;
    if (action.type === "open" && !this.target) {
      normalized = { type: "open", url };
    } else if (action.type === "click" && this.target && action.targetId === this.target.targetId &&
      url === this.target.url && typeof action.selector === "string" && action.selector.trim()) {
      normalized = { type: "click", targetId: action.targetId, url, selector: action.selector };
    } else {
      throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Ação ou target do navegador inválido.");
    }
    const prepared = prepareSandboxToolDispatch(this.flow, {
      runId: this.runId,
      sessionId: this.sessionId,
      executionMode: this.context.executionMode,
      capability: "browser.open",
      target: { kind: "url", url: JSON.stringify([this.runId, this.sessionId, normalized]) },
      requestId,
    });
    this.used.add(requestId);
    this.pending.set(requestId, normalized);
    return prepared;
  }

  decide(requestId: string, decision: "allow" | "deny") {
    this.assertAvailable();
    return this.flow.decide(requestId, decision, "once");
  }

  async execute(requestId: string): Promise<BrowserSessionEvidence> {
    this.assertAvailable();
    const action = this.pending.get(requestId);
    const grant = this.flow.consumeAuthorizedRequest(requestId);
    if (!action || !grant || grant.target.kind !== "url" ||
      grant.target.url !== JSON.stringify([this.runId, this.sessionId, action])) {
      throw new ProtocolError(
        this.flow.wasDenied(requestId) ? PROTOCOL_ERROR_CODES.OUT_OF_SCOPE : PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Ação não autorizada.",
      );
    }
    this.pending.delete(requestId);
    this.busy = true;
    const transport = this.manager.getTransport();
    try {
      if (action.type === "open") {
        if (this.target) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Target já aberto.");
        this.target = await this.manager.createIsolatedTarget("about:blank");
        if (this.closed) {
          await this.manager.closeTarget(this.target.targetId);
          throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
        }
        await transport.send("Page.enable", {}, this.target.sessionId);
        await transport.send("Runtime.enable", {}, this.target.sessionId);
        this.allowedNavigation = action.url;
        this.blockedNavigation = false;
        await transport.send("Fetch.enable", {
          patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
        }, this.target.sessionId);
        const targetSessionId = this.target.sessionId;
        let offLoad = () => {};
        let cancelLoad = () => {};
        let timer: ReturnType<typeof setTimeout> | undefined;
        const loaded = new Promise<void>((resolve, reject) => {
          offLoad = transport.on("Page.loadEventFired", (_params, sid) => {
            if (sid === targetSessionId) resolve();
          });
          cancelLoad = () => reject(new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada."));
          this.cancelListeners.add(cancelLoad);
          timer = setTimeout(() => reject(new ProtocolError(
            PROTOCOL_ERROR_CODES.INVALID_STATE, "Tempo limite de carregamento excedido.",
          )), 15_000);
        });
        // The navigation command can fail before the load promise is awaited.
        void loaded.catch(() => {});
        try {
          const navigation = await transport.send("Page.navigate", { url: action.url }, targetSessionId);
          if (navigation["errorText"]) throw new ProtocolError(
            this.blockedNavigation ? PROTOCOL_ERROR_CODES.OUT_OF_SCOPE : PROTOCOL_ERROR_CODES.INVALID_STATE,
            "Navegação falhou.",
          );
          await loaded;
        } finally {
          offLoad();
          this.cancelListeners.delete(cancelLoad);
          clearTimeout(timer);
        }
        if (this.closed) throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
        const location = await transport.send("Runtime.evaluate", {
          expression: "location.href", returnByValue: true,
        }, targetSessionId);
        if ((location["result"] as { value?: unknown } | undefined)?.value !== action.url) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.OUT_OF_SCOPE, "A navegação terminou em outra URL.");
        }
        this.target.url = action.url;
      } else {
        const target = this.target;
        if (!target || target.targetId !== action.targetId) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Target não encontrado.");
        }
        if (this.closed) throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
        const result = await transport.send("Runtime.evaluate", {
          expression: `(() => { if (location.href !== ${JSON.stringify(action.url)}) return {outOfScope: true}; const element = document.querySelector(${JSON.stringify(action.selector)}); if (!element) throw new Error("Elemento não encontrado"); element.click(); return {clicked: true}; })()`,
          returnByValue: true,
        }, target.sessionId);
        if (result["exceptionDetails"]) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Interação falhou.");
        }
        if ((result["result"] as { value?: { outOfScope?: boolean } } | undefined)?.value?.outOfScope) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.OUT_OF_SCOPE, "URL atual não corresponde à autorização.");
        }
      }
      if (this.closed || !this.target) throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
      const screenshot = await transport.send("Page.captureScreenshot", { format: "png" }, this.target.sessionId);
      if (this.closed) throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
      if (typeof screenshot["data"] !== "string" || !screenshot["data"]) {
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Captura inválida.");
      }
      const evidence: BrowserSessionEvidence = {
        runId: this.runId, targetId: this.target.targetId, url: action.url, action,
        screenshot: screenshot["data"], screenshotMimeType: "image/png",
        consoleLogs: [...this.logs],
      };
      this.evidence.push(evidence);
      return structuredClone(evidence);
    } finally {
      this.busy = false;
    }
  }

  getEvidence(): readonly BrowserSessionEvidence[] {
    return structuredClone(this.evidence);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const cancel of this.cancelListeners) cancel();
    this.cancelListeners.clear();
    this.pending.clear();
    this.offConsole();
    this.offRequests();
    try {
      await this.manager.dispose();
    } finally {
      await this.manager.getTransport().close();
    }
  }

  private assertAvailable(): void {
    if (this.closed) throw new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Execução cancelada.");
    if (this.busy) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Outra ação está em andamento.");
  }
}
