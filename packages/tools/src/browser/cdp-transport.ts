import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import type {
  BrowserConsoleLogEntry,
  BrowserTargetInfo,
  CdpTransport,
} from "./types.js";

/** PNG 1x1 transparente mínimo em base64 para captura padrão de teste. */
export const MOCK_SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

interface MockTargetRecord {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId: string;
  sessionId?: string;
  consoleLogs: BrowserConsoleLogEntry[];
}

/**
 * Transporte CDP em memória determinístico para testes unitários e de integração (AUT-01).
 */
export class InMemoryCdpTransport implements CdpTransport {
  private closed = false;
  private nextId = 1;
  private readonly browserContexts = new Set<string>();
  private readonly targets = new Map<string, MockTargetRecord>();
  private readonly sessionToTarget = new Map<string, string>();
  private readonly listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >();

  isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.targets.clear();
    this.sessionToTarget.clear();
    this.browserContexts.clear();
    this.listeners.clear();
  }

  on(
    event: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit(
    event: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener(params, sessionId);
    }
  }

  emitConsoleLog(sessionId: string, log: BrowserConsoleLogEntry): void {
    const targetId = this.sessionToTarget.get(sessionId);
    if (targetId) {
      const target = this.targets.get(targetId);
      target?.consoleLogs.push(log);
    }
    this.emit(
      "Runtime.consoleAPICalled",
      {
        type: log.type,
        args: [{ type: "string", value: log.text }],
        timestamp: log.timestamp,
      },
      sessionId,
    );
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Conexão CDP já encerrada.",
      );
    }

    switch (method) {
      case "Target.createBrowserContext": {
        const browserContextId = `ctx-${this.nextId++}`;
        this.browserContexts.add(browserContextId);
        return { browserContextId };
      }

      case "Target.disposeBrowserContext": {
        const browserContextId = String(params["browserContextId"] ?? "");
        if (!browserContextId || !this.browserContexts.has(browserContextId)) {
          throw new ProtocolError(
            PROTOCOL_ERROR_CODES.INVALID_STATE,
            `BrowserContext não encontrado: ${browserContextId}`,
          );
        }
        this.browserContexts.delete(browserContextId);
        return {};
      }

      case "Target.createTarget": {
        const targetId = `target-${this.nextId++}`;
        const url = String(params["url"] ?? "about:blank");
        const browserContextId = String(
          params["browserContextId"] ?? `ctx-${this.nextId++}`,
        );
        this.browserContexts.add(browserContextId);
        const record: MockTargetRecord = {
          targetId,
          type: "page",
          title: "Página em target isolado",
          url,
          attached: false,
          browserContextId,
          consoleLogs: [],
        };
        this.targets.set(targetId, record);
        return { targetId };
      }

      case "Target.attachToTarget": {
        const targetId = String(params["targetId"] ?? "");
        const target = this.targets.get(targetId);
        if (!target) {
          throw new ProtocolError(
            PROTOCOL_ERROR_CODES.INVALID_STATE,
            `Target não encontrado para attach: ${targetId}`,
          );
        }
        const sid = `session-${this.nextId++}`;
        target.attached = true;
        target.sessionId = sid;
        this.sessionToTarget.set(sid, targetId);
        return { sessionId: sid };
      }

      case "Target.closeTarget": {
        const targetId = String(params["targetId"] ?? "");
        const target = this.targets.get(targetId);
        if (!target) {
          throw new ProtocolError(
            PROTOCOL_ERROR_CODES.INVALID_STATE,
            `Target não encontrado para close: ${targetId}`,
          );
        }
        if (target.sessionId) {
          this.sessionToTarget.delete(target.sessionId);
        }
        this.targets.delete(targetId);
        return { success: true };
      }

      case "Target.getTargets": {
        const targetInfos: BrowserTargetInfo[] = [];
        for (const t of this.targets.values()) {
          targetInfos.push({
            targetId: t.targetId,
            type: t.type,
            title: t.title,
            url: t.url,
            attached: t.attached,
            browserContextId: t.browserContextId,
          });
        }
        return { targetInfos: targetInfos as unknown as Record<string, unknown>[] };
      }

      case "Page.enable":
      case "Runtime.enable":
      case "Console.enable": {
        return {};
      }

      case "Page.navigate": {
        const url = String(params["url"] ?? "");
        if (sessionId) {
          const targetId = this.sessionToTarget.get(sessionId);
          if (targetId) {
            const target = this.targets.get(targetId);
            if (target) {
              target.url = url;
              target.title = `Página: ${url}`;
            }
          }
        }
        // Emite log padrão e evento de carga
        if (sessionId) {
          this.emitConsoleLog(sessionId, {
            type: "log",
            text: `[console] Navegação concluída com sucesso para ${url}`,
            timestamp: Date.now(),
          });
          this.emit("Page.loadEventFired", { timestamp: Date.now() }, sessionId);
        }
        return { frameId: "frame-main" };
      }

      case "Page.captureScreenshot": {
        return { data: MOCK_SCREENSHOT_BASE64 };
      }

      case "Runtime.evaluate": {
        const expression = String(params["expression"] ?? "");
        if (expression.includes("document.title")) {
          let title = "OpenAgent Browser Target";
          if (sessionId) {
            const targetId = this.sessionToTarget.get(sessionId);
            if (targetId) {
              const target = this.targets.get(targetId);
              if (target?.title) {
                title = target.title;
              }
            }
          }
          return { result: { type: "string", value: title } };
        }
        return {
          result: {
            type: "object",
            value: { executed: true, expression },
          },
        };
      }

      default: {
        return {};
      }
    }
  }
}

/**
 * Transporte CDP via WebSocket nativo do Node.
 */
export class WebSocketCdpTransport implements CdpTransport {
  private ws: WebSocket | null = null;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >();

  constructor(private readonly endpoint: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.endpoint);
        this.ws = ws;

        ws.onopen = () => resolve();
        ws.onerror = (err) => {
          reject(
            new ProtocolError(
              PROTOCOL_ERROR_CODES.INVALID_STATE,
              `Falha ao conectar via WebSocket CDP: ${String(err)}`,
            ),
          );
        };
        ws.onclose = () => {
          this.closed = true;
          for (const [, pending] of this.pending) {
            pending.reject(
              new ProtocolError(
                PROTOCOL_ERROR_CODES.INVALID_STATE,
                "Conexão WebSocket CDP fechada.",
              ),
            );
          }
          this.pending.clear();
        };

        ws.onmessage = (event) => {
          try {
            const rawData =
              typeof event.data === "string"
                ? event.data
                : String(event.data);
            const message = JSON.parse(rawData) as Record<string, unknown>;

            if (typeof message["id"] === "number") {
              const pending = this.pending.get(message["id"]);
              if (pending) {
                this.pending.delete(message["id"]);
                if (message["error"]) {
                  pending.reject(
                    new ProtocolError(
                      PROTOCOL_ERROR_CODES.INVALID_STATE,
                      `Erro retornado pelo CDP: ${JSON.stringify(message["error"])}`,
                    ),
                  );
                } else {
                  pending.resolve(
                    (message["result"] ?? {}) as Record<string, unknown>,
                  );
                }
              }
              return;
            }

            if (typeof message["method"] === "string") {
              const method = message["method"];
              const params = (message["params"] ?? {}) as Record<string, unknown>;
              const sid = message["sessionId"] as string | undefined;
              const set = this.listeners.get(method);
              if (set) {
                for (const listener of set) {
                  listener(params, sid);
                }
              }
            }
          } catch {
            // Ignora mensagem com JSON inválido
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pending.clear();
    this.listeners.clear();
  }

  on(
    event: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  async send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    if (this.closed || !this.ws) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "WebSocket CDP não está conectado.",
      );
    }

    const id = this.nextId++;
    const payload: Record<string, unknown> = {
      id,
      method,
      params: params ?? {},
    };
    if (sessionId) {
      payload["sessionId"] = sessionId;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws?.send(JSON.stringify(payload));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}
