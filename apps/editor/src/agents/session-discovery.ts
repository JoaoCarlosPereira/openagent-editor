import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
} from "@openagent/protocol";

import {
  buildSessionDiscoveryView,
  type SessionDiscoveryUiPhase,
  type SessionDiscoveryViewSnapshot,
} from "./session-discovery-view.js";

export type {
  SessionDiscoveryUiPhase,
  SessionDiscoveryViewItem,
  SessionDiscoveryViewSnapshot,
} from "./session-discovery-view.js";
export { buildSessionDiscoveryView } from "./session-discovery-view.js";

/** Resultado de sessão headless retornado pelo daemon/storage. */
export type HeadlessSessionItem = {
  sessionId: string;
  mode: string;
  messageCount: number;
};

/** Porta injetável para o daemon/listar sessões headless. */
export interface SessionDiscoveryListPort {
  listSessionMessages(input: {
    sessionId: string;
  }): Promise<{
    sessionId: string;
    messages: readonly { id: string; role: string; content: string }[];
  }>;
}

/** Opções opcionais para a requisição de listagem. */
export interface SessionListOptions {
  limit?: number;
  targetWorkspaceId?: string;
  allowedWorkspaceId?: string;
}

/** Resultado do pedido de listagem RPC session.list. */
export interface SessionListRequestResult {
  rpc: {
    method: typeof RPC_METHOD.SESSION_LIST;
    params: { limit?: number };
  };
  view: SessionDiscoveryViewSnapshot;
}

/** Resultado de listagem via porta (daemon/storage). */
export interface SessionListViaPortResult {
  rpc: SessionListRequestResult["rpc"];
  sessions: readonly HeadlessSessionItem[];
  view: SessionDiscoveryViewSnapshot;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function outOfScope(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.OUT_OF_SCOPE, message, [...details]);
}

/**
 * CLI-02: quando uma execução headless da CLI termina, mostrar essa sessão
 * ao abrir o mesmo workspace no editor.
 *
 * O controller lista sessões do workspace via porta, filtra as que têm
 * mensagens e exibe o resultado na UI.
 */
export class SessionDiscoveryController {
  private readonly sessionIdValue: string;
  private readonly workspaceIdValue: string;
  private phase: SessionDiscoveryUiPhase = "idle";
  private headlessSessions: HeadlessSessionItem[] = [];
  private errorMessage: string | null = null;
  private view: SessionDiscoveryViewSnapshot;

  constructor(sessionId: string, workspaceId: string) {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidState("sessionId inválido para descoberta de sessões headless.", ["sessionId"]);
    }
    if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
      throw invalidState("workspaceId inválido para descoberta de sessões headless.", ["workspaceId"]);
    }
    this.sessionIdValue = sessionId.trim();
    this.workspaceIdValue = workspaceId.trim();
    this.view = emptyView(this.sessionIdValue, this.workspaceIdValue);
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get workspaceId(): string {
    return this.workspaceIdValue;
  }

  get snapshot(): SessionDiscoveryViewSnapshot {
    return this.view;
  }

  /**
   * Solicita listagem RPC de sessões do workspace.
   * Não lista mensagens até acceptResults (fase pending).
   */
  requestList(options: SessionListOptions = {}): SessionListRequestResult {
    if (this.phase !== "idle") {
      throw invalidState("Listagem de sessões só pode ser iniciada a partir do estado ocioso.", [
        this.phase,
      ]);
    }
    if (
      options.targetWorkspaceId !== undefined &&
      options.allowedWorkspaceId !== undefined &&
      options.targetWorkspaceId !== options.allowedWorkspaceId
    ) {
      throw outOfScope("Sessão fora do escopo do workspace autorizado.", [
        options.targetWorkspaceId,
        options.allowedWorkspaceId,
      ]);
    }
    this.phase = "pending";
    this.errorMessage = null;
    this.refreshView();
    return {
      rpc: {
        method: RPC_METHOD.SESSION_LIST,
        params: { limit: options.limit ?? 100 },
      },
      view: this.view,
    };
  }

  /**
   * Confirma o resultado da listagem e exibe as sessões headless.
   * Filtra sessões sem mensagens (são sessões de trabalho, não headless).
   */
  acceptResults(raw: unknown): SessionDiscoveryViewSnapshot {
    if (this.phase !== "pending") {
      throw invalidState("Resultado de listagem só é aceito após requestList pendente.", [
        this.phase,
      ]);
    }
    const before = this.snapshotInternalState();
    try {
      const parsed = parseListResult(raw);
      // Filtra: sessões headless são aquelas com ao menos uma mensagem.
      this.headlessSessions = parsed.sessions.filter((s) => s.messageCount > 0);
      if (this.headlessSessions.length === 0 && parsed.sessions.length === 0) {
        // Nenhum resultado do daemon.
        this.phase = "results";
        this.refreshView();
        return this.view;
      }
      this.phase = "results";
      this.refreshView();
      return this.view;
    } catch (error) {
      this.restoreInternalState(before);
      this.refreshView();
      throw error;
    }
  }

  /**
   * Atalho: RPC + porta do daemon/storage em uma chamada.
   */
  async listViaPort(
    port: SessionDiscoveryListPort,
    options: SessionListOptions = {},
  ): Promise<SessionListViaPortResult> {
    const pending = this.requestList(options);
    try {
      const result = await port.listSessionMessages({
        sessionId: this.sessionIdValue,
      });
      const sessions: HeadlessSessionItem[] = [
        {
          sessionId: result.sessionId,
          mode: "agent",
          messageCount: result.messages.length,
        },
      ];
      const view = this.acceptResults({ sessions });
      return { rpc: pending.rpc, sessions, view };
    } catch (error) {
      if (this.phase === "pending") {
        this.phase = "error";
        this.errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      }
      this.refreshView();
      throw error;
    }
  }

  /**
   * CLI-02: recarrega as sessões headless (botão "Atualizar").
   * Reseta o estado para idle e tenta novamente.
   */
  refresh(): SessionDiscoveryViewSnapshot {
    this.phase = "idle";
    this.errorMessage = null;
    this.refreshView();
    return this.view;
  }

  /**
   * CLI-02: erro canônico — retorna snapshot limpo sem efeito colateral.
   * INVALID_STATE e OUT_OF_SCOPE são tratados aqui.
   */
  handleInvalidState(): SessionDiscoveryViewSnapshot {
    this.phase = "error";
    this.errorMessage = "Estado inválido para descoberta de sessões headless.";
    this.refreshView();
    return this.view;
  }

  handleOutOfScope(): SessionDiscoveryViewSnapshot {
    this.phase = "error";
    this.errorMessage = "Sessão fora do escopo do workspace autorizado.";
    this.refreshView();
    return this.view;
  }

  private snapshotInternalState(): {
    phase: SessionDiscoveryUiPhase;
    headlessSessions: HeadlessSessionItem[];
    errorMessage: string | null;
  } {
    return {
      phase: this.phase,
      headlessSessions: [...this.headlessSessions],
      errorMessage: this.errorMessage,
    };
  }

  private restoreInternalState(state: {
    phase: SessionDiscoveryUiPhase;
    headlessSessions: HeadlessSessionItem[];
    errorMessage: string | null;
  }): void {
    this.phase = state.phase;
    this.headlessSessions = [...state.headlessSessions];
    this.errorMessage = state.errorMessage;
  }

  private refreshView(): void {
    this.view = buildSessionDiscoveryView({
      sessionId: this.sessionIdValue,
      workspaceId: this.workspaceIdValue,
      phase: this.phase,
      headlessSessions: this.headlessSessions,
      errorMessage: this.errorMessage,
    });
  }
}

function emptyView(sessionId: string, workspaceId: string): SessionDiscoveryViewSnapshot {
  return buildSessionDiscoveryView({
    sessionId,
    workspaceId,
    phase: "idle",
    headlessSessions: [],
    errorMessage: null,
  });
}

/**
 * CLI-02: parseia o resultado de session.list (RPC) para HeadlessSessionItem.
 * Formato esperado: { sessions: [{ sessionId, mode, messageCount }] }
 */
function parseListResult(raw: unknown): { sessions: HeadlessSessionItem[] } {
  if (
    typeof raw !== "object" || raw === null || Array.isArray(raw)
  ) {
    throw invalidState("Resultado de listagem inválido.", ["result"]);
  }
  const record = raw as Record<string, unknown>;
  const sessions = record.sessions;
  if (!Array.isArray(sessions)) {
    throw invalidState("Campo 'sessions' inválido no resultado de listagem.", ["sessions"]);
  }
  const items: HeadlessSessionItem[] = [];
  for (const [index, item] of sessions.entries()) {
    items.push(parseSessionItem(item, index));
  }
  return { sessions: items };
}

function parseSessionItem(raw: unknown, index: number): HeadlessSessionItem {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidState(`Item de sessão inválido.`, [`sessions[${index}]`]);
  }
  const record = raw as Record<string, unknown>;
  const sessionId = requireNonEmptyString(record.sessionId, `sessions[${index}].sessionId`);
  const mode = requireNonEmptyString(record.mode, `sessions[${index}].mode`);
  const messageCount = record.messageCount;
  if (typeof messageCount !== "number" || !Number.isFinite(messageCount) || messageCount < 0) {
    throw invalidState(`messageCount inválido em sessions[${index}].`, [String(messageCount)]);
  }
  return { sessionId, mode, messageCount };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidState(`Campo '${field}' inválido.`, [field]);
  }
  return value.trim();
}
