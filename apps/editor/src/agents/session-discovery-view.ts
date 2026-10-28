export type SessionDiscoveryUiPhase = "idle" | "pending" | "results" | "error";

export interface SessionDiscoveryViewItem {
  sessionId: string;
  mode: string;
  messageCount: number;
}

export interface SessionDiscoveryViewInput {
  sessionId: string;
  workspaceId: string;
  phase: SessionDiscoveryUiPhase;
  headlessSessions: readonly SessionDiscoveryViewItem[];
  errorMessage: string | null;
}

export interface SessionDiscoveryViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    workspaceId: string;
    phase: SessionDiscoveryUiPhase;
    headlessSessionCount: number;
    headlessSessionIds: readonly string[];
    errorMessage: string | null;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildSessionDiscoveryView(input: SessionDiscoveryViewInput): SessionDiscoveryViewSnapshot {
  const statusText =
    input.phase === "pending"
      ? "Buscando sessões headless do workspace…"
      : input.phase === "results"
        ? input.headlessSessions.length > 0
          ? `${input.headlessSessions.length} sessão(s) headless encontrada(s)`
          : "Nenhuma sessão headless encontrada"
        : input.phase === "error"
          ? `Erro ao buscar: ${input.errorMessage}`
          : "Sessões headless da CLI aparecem ao abrir o workspace.";

  const sessionRows =
    input.headlessSessions.length > 0
      ? input.headlessSessions
          .map(
            (s) =>
              `<li data-session-id="${escapeHtml(s.sessionId)}" data-mode="${escapeHtml(s.mode)}" data-testid="headless-session-item">Sessão ${escapeHtml(s.sessionId)} — modo: ${escapeHtml(s.mode)} — mensagens: ${s.messageCount}</li>`,
          )
          .join("")
      : `<li data-testid="headless-sessions-empty">Nenhuma sessão headless encontrada.</li>`;

  const errorSection =
    input.errorMessage !== null && input.phase === "error"
      ? `<p role="alert" aria-live="assertive" data-testid="session-discovery-error">${escapeHtml(input.errorMessage)}</p>`
      : "";

  return {
    html: [
      `<section data-testid="session-discovery-panel"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-workspace-id="${escapeHtml(input.workspaceId)}"`,
      ` data-phase="${input.phase}"`,
      ` data-session-count="${input.headlessSessions.length}"`,
      `>`,
      `<h3>Sessões headless da CLI</h3>`,
      `<button type="button" data-testid="refresh-headless-sessions"`,
      input.phase === "pending" ? ` disabled` : ``,
      ` aria-label="Atualizar sessões headless">Atualizar</button>`,
      `<ul data-testid="headless-sessions-list">${sessionRows}</ul>`,
      `<p data-testid="session-discovery-status" role="status">${escapeHtml(statusText)}</p>`,
      errorSection,
      `</section>`,
    ].join(""),
    accessible: {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      phase: input.phase,
      headlessSessionCount: input.headlessSessions.length,
      headlessSessionIds: input.headlessSessions.map((s) => s.sessionId),
      errorMessage: input.errorMessage,
    },
  };
}
