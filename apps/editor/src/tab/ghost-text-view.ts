export type GhostTextPhase =
  | "idle"
  | "requesting"
  | "suggesting"
  | "accepted"
  | "rejected"
  | "cancelled";

export interface GhostTextViewInput {
  phase: GhostTextPhase;
  bufferText: string;
  cursor: number;
  suggestion: string;
  completionId: string | null;
  errorCode: string | null;
}

export interface GhostTextViewSnapshot {
  html: string;
  accessible: {
    phase: GhostTextPhase;
    statusLabel: string;
    bufferText: string;
    cursor: number;
    suggestion: string;
    completionId: string | null;
    canAccept: boolean;
    canReject: boolean;
    canCancel: boolean;
    errorCode: string | null;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function ghostTextStatusLabel(phase: GhostTextPhase): string {
  switch (phase) {
    case "idle":
      return "Sem sugestao";
    case "requesting":
      return "Gerando sugestao";
    case "suggesting":
      return "Sugestao disponivel";
    case "accepted":
      return "Sugestao aceita";
    case "rejected":
      return "Sugestao recusada";
    case "cancelled":
      return "Sugestao cancelada";
  }
}

export function buildGhostTextView(input: GhostTextViewInput): GhostTextViewSnapshot {
  const canAccept = input.phase === "suggesting" && input.suggestion.length > 0;
  const canReject = canAccept;
  const canCancel = input.phase === "requesting" || input.phase === "suggesting";
  const statusLabel = ghostTextStatusLabel(input.phase);
  const button = (testId: string, label: string, enabled: boolean, shortcut: string): string =>
    `<button type="button" data-testid="${testId}" aria-keyshortcuts="${shortcut}"${enabled ? "" : " disabled"}>${label}</button>`;

  return {
    html: [
      `<section data-testid="ghost-text-panel" data-phase="${input.phase}"`,
      input.completionId !== null
        ? ` data-completion-id="${escapeHtml(input.completionId)}"`
        : ``,
      `>`,
      `<pre data-testid="ghost-text-buffer">${escapeHtml(input.bufferText.slice(0, input.cursor))}`,
      input.suggestion.length > 0
        ? `<span data-testid="ghost-text-suggestion" aria-label="Sugestao">${escapeHtml(input.suggestion)}</span>`
        : ``,
      `${escapeHtml(input.bufferText.slice(input.cursor))}</pre>`,
      button("ghost-text-accept", "Aceitar", canAccept, "Tab"),
      button("ghost-text-reject", "Recusar", canReject, "Escape"),
      button("ghost-text-cancel", "Cancelar", canCancel, "Control+Escape"),
      `<p data-testid="ghost-text-status" role="status">${statusLabel}</p>`,
      input.errorCode !== null
        ? `<p role="alert" data-testid="ghost-text-error">${escapeHtml(input.errorCode)}</p>`
        : ``,
      `</section>`,
    ].join(""),
    accessible: {
      phase: input.phase,
      statusLabel,
      bufferText: input.bufferText,
      cursor: input.cursor,
      suggestion: input.suggestion,
      completionId: input.completionId,
      canAccept,
      canReject,
      canCancel,
      errorCode: input.errorCode,
    },
  };
}
