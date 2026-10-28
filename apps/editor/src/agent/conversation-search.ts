import { ProtocolError, RPC_METHOD } from "@openagent/protocol";

import {
  buildConversationSearchView,
  type ConversationSearchHitRow,
  type ConversationSearchUiPhase,
  type ConversationSearchViewSnapshot,
} from "./conversation-search-view.js";

export type {
  ConversationSearchHitRow,
  ConversationSearchUiPhase,
  ConversationSearchViewSnapshot,
} from "./conversation-search-view.js";
export { buildConversationSearchView } from "./conversation-search-view.js";

/** Resultado de mensagem alinhado a `searchSessionMessages` (SES-05 / task_37). */
export type ConversationSearchMessagesResult = {
  sessionId: string;
  query: string;
  hits: readonly ConversationSearchHitRow[];
};

/** Porta injetável para o daemon/storage listar mensagens com o texto. */
export interface ConversationMessageSearchPort {
  searchMessages(input: {
    sessionId: string;
    query: string;
  }): Promise<ConversationSearchMessagesResult>;
}

export interface ConversationSearchRequestResult {
  rpc: {
    method: typeof RPC_METHOD.SESSION_SEARCH;
    params: { query: string };
    sessionId: string;
  };
  view: ConversationSearchViewSnapshot;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError("INVALID_STATE", message, [...details]);
}

function emptyView(sessionId: string): ConversationSearchViewSnapshot {
  return buildConversationSearchView({
    sessionId,
    query: null,
    phase: "idle",
    hits: [],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * SES-05: busca na conversa — RPC `session.search` + listagem de mensagens
 * da sessão local que contêm o texto (hits via `acceptHits` / porta).
 */
export class ConversationSearchController {
  private readonly sessionIdValue: string;
  private query: string | null = null;
  private phase: ConversationSearchUiPhase = "idle";
  private hits: ConversationSearchHitRow[] = [];
  private view: ConversationSearchViewSnapshot;

  constructor(sessionId: string) {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidState("sessionId inválido para busca na conversa.", ["sessionId"]);
    }
    this.sessionIdValue = sessionId.trim();
    this.view = emptyView(this.sessionIdValue);
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get snapshot(): ConversationSearchViewSnapshot {
    return this.view;
  }

  listHits(): readonly ConversationSearchHitRow[] {
    return [...this.hits];
  }

  /**
   * Pedido de UI: valida o texto e devolve RPC `session.search` sem listar
   * mensagens até `acceptHits` (eco do storage/daemon).
   */
  requestSearch(queryRaw: unknown): ConversationSearchRequestResult {
    const query = this.requireNonEmptyQuery(queryRaw);
    this.query = query;
    this.phase = "pending";
    this.hits = [];
    this.refreshView();
    return {
      rpc: {
        method: RPC_METHOD.SESSION_SEARCH,
        params: { query },
        sessionId: this.sessionIdValue,
      },
      view: this.view,
    };
  }

  /**
   * Confirma o resultado lexical da sessão e lista as mensagens encontradas.
   * Aceita o formato de `searchSessionMessages` (id ou messageId no hit).
   */
  acceptHits(raw: unknown): ConversationSearchViewSnapshot {
    if (this.phase !== "pending" || this.query === null) {
      throw invalidState(
        "Resultado de busca só é aceito após requestSearch pendente.",
        [this.phase],
      );
    }
    const before = this.snapshotState();
    try {
      const parsed = this.parseSearchResult(raw);
      if (parsed.sessionId !== this.sessionIdValue) {
        throw invalidState("sessionId do resultado diverge da sessão do painel.", [
          parsed.sessionId,
          this.sessionIdValue,
        ]);
      }
      if (parsed.query.trim() !== this.query.trim()) {
        throw invalidState("query do resultado diverge da busca pendente.", [
          parsed.query,
          this.query,
        ]);
      }
      this.hits = [...parsed.hits];
      this.phase = "results";
      this.refreshView();
      return this.view;
    } catch (error) {
      this.restoreState(before);
      this.refreshView();
      throw error;
    }
  }

  /** Atalho: RPC + porta de mensagens (daemon/storage) em uma chamada. */
  async searchViaPort(
    port: ConversationMessageSearchPort,
    queryRaw: unknown,
  ): Promise<{
    rpc: ConversationSearchRequestResult["rpc"];
    result: ConversationSearchMessagesResult;
    view: ConversationSearchViewSnapshot;
  }> {
    const pending = this.requestSearch(queryRaw);
    const result = await port.searchMessages({
      sessionId: this.sessionIdValue,
      query: pending.rpc.params.query,
    });
    const view = this.acceptHits(result);
    return { rpc: pending.rpc, result, view };
  }

  private parseSearchResult(raw: unknown): ConversationSearchMessagesResult {
    if (!isRecord(raw)) {
      throw invalidState("Resultado de busca inválido.", ["result"]);
    }
    const sessionId = this.requireNonEmptyString(raw.sessionId, "sessionId");
    const query = this.requireNonEmptyQuery(raw.query);
    if (!Array.isArray(raw.hits)) {
      throw invalidState("Campo 'hits' inválido no resultado de busca.", ["hits"]);
    }
    const hits: ConversationSearchHitRow[] = [];
    for (const [index, item] of raw.hits.entries()) {
      hits.push(this.parseHit(item, index));
    }
    return { sessionId, query, hits };
  }

  private parseHit(raw: unknown, index: number): ConversationSearchHitRow {
    if (!isRecord(raw)) {
      throw invalidState("Hit de busca inválido.", [`hits[${index}]`]);
    }
    const messageIdRaw = raw.messageId ?? raw.id;
    const messageId = this.requireNonEmptyString(messageIdRaw, `hits[${index}].messageId`);
    const role = this.requireNonEmptyString(raw.role, `hits[${index}].role`);
    const status = this.requireNonEmptyString(raw.status, `hits[${index}].status`);
    const lexicalSnippet = this.requireNonEmptyString(
      raw.lexicalSnippet,
      `hits[${index}].lexicalSnippet`,
    );
    return { messageId, role, status, lexicalSnippet };
  }

  private requireNonEmptyQuery(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidState("query inválida para busca.", ["query"]);
    }
    return value.trim();
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidState(`Campo '${field}' inválido.`, [field]);
    }
    return value.trim();
  }

  private snapshotState(): {
    query: string | null;
    phase: ConversationSearchUiPhase;
    hits: ConversationSearchHitRow[];
  } {
    return {
      query: this.query,
      phase: this.phase,
      hits: [...this.hits],
    };
  }

  private restoreState(state: {
    query: string | null;
    phase: ConversationSearchUiPhase;
    hits: ConversationSearchHitRow[];
  }): void {
    this.query = state.query;
    this.phase = state.phase;
    this.hits = [...state.hits];
  }

  private refreshView(): void {
    this.view = buildConversationSearchView({
      sessionId: this.sessionIdValue,
      query: this.query,
      phase: this.phase,
      hits: this.hits,
    });
  }
}
