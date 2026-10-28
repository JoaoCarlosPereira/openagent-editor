/** SES-05: listagem observável das mensagens da sessão que contêm o texto buscado. */

export type ConversationSearchHitRow = {
  messageId: string;
  role: string;
  status: string;
  lexicalSnippet: string;
};

export type ConversationSearchUiPhase = "idle" | "pending" | "results";

export interface ConversationSearchViewInput {
  sessionId: string;
  query: string | null;
  phase: ConversationSearchUiPhase;
  hits: readonly ConversationSearchHitRow[];
}

export interface ConversationSearchViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    query: string | null;
    phase: ConversationSearchUiPhase;
    hitCount: number;
    messageIds: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHit(hit: ConversationSearchHitRow): string {
  return [
    `<li data-testid="conversation-search-hit"`,
    ` data-message-id="${escapeHtml(hit.messageId)}"`,
    ` data-role="${escapeHtml(hit.role)}"`,
    ` data-status="${escapeHtml(hit.status)}">`,
    `<span data-testid="conversation-search-hit-role">${escapeHtml(hit.role)}</span>`,
    `<p data-testid="conversation-search-hit-snippet">${escapeHtml(hit.lexicalSnippet)}</p>`,
    `</li>`,
  ].join("");
}

/** SES-05: campo de busca + lista de mensagens da sessão local com o texto. */
export function buildConversationSearchView(
  input: ConversationSearchViewInput,
): ConversationSearchViewSnapshot {
  const messageIds = input.hits.map((hit) => hit.messageId);
  const queryAttr =
    input.query !== null ? ` data-query="${escapeHtml(input.query)}"` : "";

  const hitsBlock =
    input.phase === "results" && input.hits.length === 0
      ? `<p data-testid="conversation-search-empty">Nenhuma mensagem contém esse texto.</p>`
      : input.hits.length > 0
        ? [
            `<ol data-testid="conversation-search-hits" aria-label="Mensagens encontradas">`,
            ...input.hits.map(renderHit),
            `</ol>`,
          ].join("")
        : `<p data-testid="conversation-search-idle">Busque um texto na conversa.</p>`;

  const pendingHint =
    input.phase === "pending"
      ? `<p data-testid="conversation-search-pending">Buscando…</p>`
      : "";

  const html = [
    `<section role="search" aria-labelledby="conversation-search-title"`,
    ` data-testid="conversation-search-panel"`,
    ` data-session-id="${escapeHtml(input.sessionId)}"`,
    ` data-phase="${escapeHtml(input.phase)}"${queryAttr}>`,
    `<h2 id="conversation-search-title">Busca na conversa</h2>`,
    `<label for="conversation-search-input">Texto</label>`,
    `<input id="conversation-search-input" type="search"`,
    ` data-testid="conversation-search-input"`,
    ` aria-label="Buscar na conversa"`,
    ` value="${escapeHtml(input.query ?? "")}" />`,
    pendingHint,
    hitsBlock,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      sessionId: input.sessionId,
      query: input.query,
      phase: input.phase,
      hitCount: input.hits.length,
      messageIds,
    },
  };
}
