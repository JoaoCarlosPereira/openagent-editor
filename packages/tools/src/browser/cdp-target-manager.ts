import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import type {
  BrowserTargetInfo,
  BrowserTargetSession,
  CdpTransport,
} from "./types.js";

/**
 * Gerenciador de targets isolados via Chrome DevTools Protocol (CDP) (AUT-01).
 * Garante que cada target abra com seu próprio browserContextId para isolamento total.
 */
export class CdpTargetManager {
  private readonly activeTargets = new Map<string, BrowserTargetSession>();
  private readonly contextTargets = new Map<string, Set<string>>();
  private readonly sessionToTarget = new Map<string, string>();

  constructor(private readonly transport: CdpTransport) {}

  getTransport(): CdpTransport {
    return this.transport;
  }

  /**
   * Cria um novo target com contexto isolado (Target.createBrowserContext + Target.createTarget).
   */
  async createIsolatedTarget(
    url = "about:blank",
    options?: { browserContextId?: string },
  ): Promise<BrowserTargetSession> {
    if (this.transport.isClosed()) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Transporte CDP está encerrado.",
      );
    }

    const ownsBrowserContext = !options?.browserContextId;
    let browserContextId = options?.browserContextId ?? "";
    if (!browserContextId) {
      const contextRes = await this.transport.send(
        "Target.createBrowserContext",
        { disposeOnDetach: true },
      );
      browserContextId = String(contextRes["browserContextId"] ?? "");
      if (!browserContextId) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Falha ao criar browserContext isolado no CDP.",
        );
      }
    }

    let targetId: string | undefined;
    try {
      const targetRes = await this.transport.send("Target.createTarget", {
        url,
        browserContextId,
      });
      targetId = String(targetRes["targetId"] ?? "");
      if (!targetId) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Falha ao criar target no CDP.",
        );
      }

      const attachRes = await this.transport.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const sessionId = String(attachRes["sessionId"] ?? "");
      if (!sessionId) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Falha ao vincular sessão ao target CDP (attachToTarget).",
        );
      }

      const session: BrowserTargetSession = {
        targetId,
        sessionId,
        browserContextId,
        url,
      };

      this.activeTargets.set(targetId, session);
      this.sessionToTarget.set(sessionId, targetId);

      let targetsInContext = this.contextTargets.get(browserContextId);
      if (!targetsInContext) {
        targetsInContext = new Set();
        this.contextTargets.set(browserContextId, targetsInContext);
      }
      targetsInContext.add(targetId);

      return session;
    } catch (error) {
      if (targetId) {
        try {
          await this.transport.send("Target.closeTarget", { targetId });
        } catch {
          // Preserve the original CDP error while attempting rollback.
        }
      }
      if (ownsBrowserContext) {
        try {
          await this.transport.send("Target.disposeBrowserContext", {
            browserContextId,
          });
        } catch {
          // Preserve the original CDP error while attempting rollback.
        }
      }
      throw error;
    }
  }

  /**
   * Fecha um target e descarta o browserContext se não houver mais targets nele.
   */
  async closeTarget(targetId: string): Promise<boolean> {
    const session = this.activeTargets.get(targetId);
    if (!session) {
      return false;
    }

    await this.transport.send("Target.closeTarget", { targetId });

    this.activeTargets.delete(targetId);
    this.sessionToTarget.delete(session.sessionId);

    const targetsInContext = this.contextTargets.get(session.browserContextId);
    if (targetsInContext) {
      targetsInContext.delete(targetId);
      if (targetsInContext.size === 0) {
        try {
          await this.transport.send("Target.disposeBrowserContext", {
            browserContextId: session.browserContextId,
          });
        } catch {
          // Ignora erro se o contexto já foi descartado pelo runtime
        }
        this.contextTargets.delete(session.browserContextId);
      }
    }

    return true;
  }

  getSession(targetId: string): BrowserTargetSession | undefined {
    return this.activeTargets.get(targetId);
  }

  getSessionBySessionId(sessionId: string): BrowserTargetSession | undefined {
    const targetId = this.sessionToTarget.get(sessionId);
    return targetId ? this.activeTargets.get(targetId) : undefined;
  }

  listActiveTargetIds(): string[] {
    return Array.from(this.activeTargets.keys());
  }

  async getActiveTargets(): Promise<readonly BrowserTargetInfo[]> {
    if (this.transport.isClosed()) {
      return [];
    }
    const res = await this.transport.send("Target.getTargets");
    const rawList = res["targetInfos"];
    if (Array.isArray(rawList)) {
      return rawList as unknown as BrowserTargetInfo[];
    }
    const local: BrowserTargetInfo[] = [];
    for (const s of this.activeTargets.values()) {
      local.push({
        targetId: s.targetId,
        type: "page",
        title: "Página em target isolado",
        url: s.url,
        attached: true,
        browserContextId: s.browserContextId,
      });
    }
    return local;
  }

  async dispose(): Promise<void> {
    const targetIds = Array.from(this.activeTargets.keys());
    for (const targetId of targetIds) {
      try {
        await this.closeTarget(targetId);
      } catch {
        // Continua limpando os demais
      }
    }
    this.activeTargets.clear();
    this.sessionToTarget.clear();
    this.contextTargets.clear();
  }
}
