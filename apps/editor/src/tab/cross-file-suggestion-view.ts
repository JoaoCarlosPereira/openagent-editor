export type CrossFileSuggestionPhase =
  | "pending"
  | "reviewing"
  | "approved"
  | "rejected";

export interface CrossFileSuggestionViewInput {
  phase: CrossFileSuggestionPhase;
  root: string;
  relativePath: string | null;
  proposedContent: string | null;
  originalContent: string | null;
}

export interface CrossFileSuggestionViewSnapshot {
  html: string;
  accessible: {
    phase: CrossFileSuggestionPhase;
    root: string;
    relativePath: string | null;
    /** true quando a fase em revisão mostra o caminho do arquivo alvo. */
    showsTargetPath: boolean;
    /** true somente quando aplicar exige aprovacao explicita (revisao). */
    requiresReview: boolean;
    canApprove: boolean;
    canReject: boolean;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function crossFileStatusLabel(phase: CrossFileSuggestionPhase): string {
  switch (phase) {
    case "pending":
      return "Sem sugestao em outro arquivo";
    case "reviewing":
      return "Sugestao em revisao";
    case "approved":
      return "Sugestao aplicada";
    case "rejected":
      return "Sugestao rejeitada";
  }
}

export function buildCrossFileSuggestionView(
  input: CrossFileSuggestionViewInput,
): CrossFileSuggestionViewSnapshot {
  const requiresReview = input.phase === "reviewing";
  const canApprove = requiresReview;
  const canReject = requiresReview;
  const showsTargetPath = input.relativePath !== null;
  const statusLabel = crossFileStatusLabel(input.phase);
  return {
    html: [
      `<section data-testid="cross-file-panel" data-phase="${input.phase}">`,
      showsTargetPath && input.relativePath !== null
        ? `<p data-testid="cross-file-path">${escapeHtml(input.relativePath)}</p>`
        : ``,
      `<p data-testid="cross-file-status" role="status">${statusLabel}</p>`,
      requiresReview
        ? `<button type="button" data-testid="cross-file-approve">Aplicar</button>`
        : ``,
      requiresReview
        ? `<button type="button" data-testid="cross-file-reject">Rejeitar</button>`
        : ``,
      `</section>`,
    ].join(""),
    accessible: {
      phase: input.phase,
      root: input.root,
      relativePath: input.relativePath,
      showsTargetPath,
      requiresReview,
      canApprove,
      canReject,
    },
  };
}
