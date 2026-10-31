export type SideConversationUiPhase = "idle" | "pending" | "opened";

export interface SideConversationViewInput {
  parentSessionId: string;
  forkSessionId: string | null;
  phase: SideConversationUiPhase;
}

export interface SideConversationViewSnapshot {
  html: string;
  accessible: {
    parentSessionId: string;
    forkSessionId: string | null;
    phase: SideConversationUiPhase;
    parentPreserved: boolean;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildSideConversationView(
  input: SideConversationViewInput,
): SideConversationViewSnapshot {
  const status =
    input.phase === "pending"
      ? "Abrindo conversa lateral…"
      : input.phase === "opened"
        ? "Conversa lateral aberta. A conversa principal foi preservada."
        : "Abra uma conversa lateral a partir desta conversa.";
  const forkAttribute =
    input.forkSessionId === null
      ? ""
      : ` data-fork-session-id="${escapeHtml(input.forkSessionId)}"`;

  return {
    html: [
      `<section data-testid="side-conversation-panel"`,
      ` data-parent-session-id="${escapeHtml(input.parentSessionId)}"`,
      ` data-phase="${input.phase}"${forkAttribute}>`,
      `<h2>Conversa lateral</h2>`,
      `<button type="button" data-testid="side-conversation-open"`,
      ` aria-label="Abrir conversa lateral">Abrir conversa lateral</button>`,
      `<p data-testid="side-conversation-status" role="status">${status}</p>`,
      `</section>`,
    ].join(""),
    accessible: {
      parentSessionId: input.parentSessionId,
      forkSessionId: input.forkSessionId,
      phase: input.phase,
      parentPreserved: true,
    },
  };
}
