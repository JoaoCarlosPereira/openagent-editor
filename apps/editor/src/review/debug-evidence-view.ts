/** AGT-04: hipótese, evidência e verificação do modo Debug no painel do agente. */

export type DebugEvidencePhase = "idle" | "hypothesis" | "evidence" | "verified";

export type DebugVerificationOutcome = "confirmed" | "rejected";

export interface DebugEvidenceViewInput {
  phase: DebugEvidencePhase;
  hypothesis: string;
  invocationIds: readonly string[];
  toolResultCount: number;
  verificationOutcome: DebugVerificationOutcome | null;
  verificationSummary: string;
}

export interface DebugEvidenceViewSnapshot {
  html: string;
  accessible: {
    phase: DebugEvidencePhase;
    hypothesis: string;
    invocationIds: readonly string[];
    toolResultCount: number;
    verificationOutcome: DebugVerificationOutcome | null;
    verificationSummary: string;
    canMarkCompleted: boolean;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function phaseLabel(phase: DebugEvidencePhase): string {
  switch (phase) {
    case "hypothesis":
      return "Hipótese registrada";
    case "evidence":
      return "Evidência de execução registrada";
    case "verified":
      return "Verificação concluída — tarefa pode ser marcada como concluída";
    default:
      return "Sem sessão Debug";
  }
}

export function buildDebugEvidenceView(input: DebugEvidenceViewInput): DebugEvidenceViewSnapshot {
  const canMarkCompleted = input.phase === "verified";
  const outcomeLabel =
    input.verificationOutcome === "confirmed"
      ? "Confirmada"
      : input.verificationOutcome === "rejected"
        ? "Rejeitada"
        : "";

  const evidenceSection =
    input.phase === "evidence" || input.phase === "verified"
      ? [
          `<div data-testid="debug-evidence">`,
          `<span data-testid="debug-evidence-count">${input.toolResultCount}</span>`,
          `<ul data-testid="debug-evidence-invocations">`,
          ...input.invocationIds.map(
            (id) =>
              `<li data-testid="debug-evidence-invocation" data-invocation-id="${escapeHtml(id)}">${escapeHtml(id)}</li>`,
          ),
          `</ul>`,
          `</div>`,
        ].join("")
      : "";

  const verificationSection =
    input.phase === "verified"
      ? [
          `<div data-testid="debug-verification" data-outcome="${escapeHtml(input.verificationOutcome ?? "")}">`,
          `<span data-testid="debug-verification-outcome">${escapeHtml(outcomeLabel)}</span>`,
          `<p data-testid="debug-verification-summary">${escapeHtml(input.verificationSummary)}</p>`,
          `</div>`,
        ].join("")
      : "";

  const completionBadge = canMarkCompleted
    ? `<p data-testid="debug-can-complete">Pronto para concluir</p>`
    : `<p data-testid="debug-blocked-complete">Aguardando hipótese, evidência e verificação</p>`;

  const html = [
    `<section data-testid="debug-evidence-panel" data-phase="${escapeHtml(input.phase)}" aria-label="Hipótese e evidência Debug">`,
    `<h2 data-testid="debug-panel-title">Modo Debug</h2>`,
    `<p data-testid="debug-phase">${escapeHtml(phaseLabel(input.phase))}</p>`,
    input.hypothesis
      ? `<p data-testid="debug-hypothesis">${escapeHtml(input.hypothesis)}</p>`
      : "",
    evidenceSection,
    verificationSection,
    completionBadge,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      phase: input.phase,
      hypothesis: input.hypothesis,
      invocationIds: input.invocationIds,
      toolResultCount: input.toolResultCount,
      verificationOutcome: input.verificationOutcome,
      verificationSummary: input.verificationSummary,
      canMarkCompleted,
    },
  };
}
