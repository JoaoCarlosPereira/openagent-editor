import { ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  buildSideConversationView,
  type SideConversationUiPhase,
  type SideConversationViewSnapshot,
} from "./side-conversation-view.js";

export type { SideConversationUiPhase, SideConversationViewSnapshot } from "./side-conversation-view.js";
export { buildSideConversationView } from "./side-conversation-view.js";

export interface SideConversationForkResult {
  sessionId: string;
  parentSessionId: string;
}

export interface SideConversationForkPort {
  forkSession(input: {
    method: typeof RPC_METHOD.SESSION_FORK;
    sessionId: string;
    params: { branchId: string };
  }): Promise<SideConversationForkResult>;
}

export interface SideConversationRequestResult {
  rpc: {
    method: typeof RPC_METHOD.SESSION_FORK;
    sessionId: string;
    params: { branchId: string };
  };
  view: SideConversationViewSnapshot;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError("INVALID_STATE", message, [...details]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SideConversationController {
  private readonly parentSessionIdValue: string;
  private phase: SideConversationUiPhase = "idle";
  private forkSessionId: string | null = null;
  private view: SideConversationViewSnapshot;

  constructor(parentSessionId: string) {
    if (typeof parentSessionId !== "string" || parentSessionId.trim().length === 0) {
      throw invalidState("sessionId inválido para conversa lateral.", ["sessionId"]);
    }
    this.parentSessionIdValue = parentSessionId.trim();
    this.view = this.buildView();
  }

  get parentSessionId(): string {
    return this.parentSessionIdValue;
  }

  get snapshot(): SideConversationViewSnapshot {
    return this.view;
  }

  requestFork(branchIdRaw: unknown): SideConversationRequestResult {
    if (this.phase !== "idle") {
      throw invalidState("Conversa lateral só pode ser aberta a partir do estado ocioso.", [
        this.phase,
      ]);
    }
    if (typeof branchIdRaw !== "string" || branchIdRaw.trim().length === 0) {
      throw invalidState("branchId inválido para conversa lateral.", ["branchId"]);
    }
    const branchId = branchIdRaw.trim();
    this.phase = "pending";
    this.refreshView();
    return {
      rpc: {
        method: RPC_METHOD.SESSION_FORK,
        sessionId: this.parentSessionIdValue,
        params: { branchId },
      },
      view: this.view,
    };
  }

  acceptFork(raw: unknown): SideConversationViewSnapshot {
    if (this.phase !== "pending") {
      throw invalidState("Resultado de fork só é aceito após requestFork pendente.", [
        this.phase,
      ]);
    }
    const parsed = this.parseResult(raw);
    if (parsed.parentSessionId !== this.parentSessionIdValue) {
      throw invalidState("parentSessionId do fork diverge da conversa principal.", [
        parsed.parentSessionId,
        this.parentSessionIdValue,
      ]);
    }
    this.forkSessionId = parsed.sessionId;
    this.phase = "opened";
    this.refreshView();
    return this.view;
  }

  async openViaPort(
    port: SideConversationForkPort,
    branchIdRaw: unknown,
  ): Promise<{ rpc: SideConversationRequestResult["rpc"]; result: SideConversationForkResult; view: SideConversationViewSnapshot }> {
    const pending = this.requestFork(branchIdRaw);
    try {
      const result = await port.forkSession(pending.rpc);
      const view = this.acceptFork(result);
      return { rpc: pending.rpc, result, view };
    } catch (error) {
      if (this.phase === "pending") {
        this.phase = "idle";
        this.refreshView();
      }
      throw error;
    }
  }

  private parseResult(raw: unknown): SideConversationForkResult {
    if (!isRecord(raw)) {
      throw invalidState("Resultado de fork inválido.", ["result"]);
    }
    const sessionId = raw.sessionId;
    const parentSessionId = raw.parentSessionId;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidState("sessionId inválido no resultado do fork.", ["sessionId"]);
    }
    if (typeof parentSessionId !== "string" || parentSessionId.trim().length === 0) {
      throw invalidState("parentSessionId inválido no resultado do fork.", ["parentSessionId"]);
    }
    if (sessionId.trim() === this.parentSessionIdValue) {
      throw invalidState("A conversa lateral deve ter sessionId distinto da principal.", [
        "sessionId",
      ]);
    }
    return { sessionId: sessionId.trim(), parentSessionId: parentSessionId.trim() };
  }

  private buildView(): SideConversationViewSnapshot {
    return buildSideConversationView({
      parentSessionId: this.parentSessionIdValue,
      forkSessionId: this.forkSessionId,
      phase: this.phase,
    });
  }

  private refreshView(): void {
    this.view = this.buildView();
  }
}
