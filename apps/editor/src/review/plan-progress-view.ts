/** AGT-02: plano e progresso do modo Plan no painel do agente. */

export interface PlanProgressStep {
  stepId: string;
  label: string;
}

export type PlanProgressPhase = "idle" | "presented" | "accepted" | "executing" | "completed";

export interface PlanProgressViewInput {
  planId: string;
  title: string;
  steps: readonly PlanProgressStep[];
  phase: PlanProgressPhase;
  currentStepId?: string | null;
  currentStepLabel?: string | null;
  completedStepIds?: readonly string[];
  completedCount?: number;
  totalSteps?: number;
  progressRatio?: number;
}

export interface PlanProgressViewSnapshot {
  html: string;
  accessible: {
    planId: string;
    title: string;
    steps: readonly PlanProgressStep[];
    phase: PlanProgressPhase;
    currentStepId: string | null;
    currentStepLabel: string | null;
    completedStepIds: readonly string[];
    completedCount: number;
    totalSteps: number;
    progressRatio: number;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStep(
  step: PlanProgressStep,
  completedStepIds: ReadonlySet<string>,
  currentStepId: string | null,
): string {
  const done = completedStepIds.has(step.stepId);
  const current = currentStepId === step.stepId;
  const status = done ? "done" : current ? "current" : "pending";
  return [
    `<li data-testid="plan-step" data-step-id="${escapeHtml(step.stepId)}" data-status="${status}">`,
    `<span data-testid="plan-step-label">${escapeHtml(step.label)}</span>`,
    `</li>`,
  ].join("");
}

export function buildPlanProgressView(input: PlanProgressViewInput): PlanProgressViewSnapshot {
  const completedStepIds = input.completedStepIds ?? [];
  const completedSet = new Set(completedStepIds);
  const currentStepId = input.currentStepId ?? null;
  const currentStepLabel = input.currentStepLabel ?? null;
  const totalSteps = input.totalSteps ?? input.steps.length;
  const completedCount = input.completedCount ?? completedStepIds.length;
  const progressRatio =
    typeof input.progressRatio === "number"
      ? input.progressRatio
      : totalSteps > 0
        ? completedCount / totalSteps
        : 0;

  const progressPercent = Math.round(Math.min(1, Math.max(0, progressRatio)) * 100);
  const phaseLabel =
    input.phase === "presented"
      ? "Plano apresentado"
      : input.phase === "accepted"
        ? "Plano aceito — execução iniciada"
        : input.phase === "executing"
          ? "Executando plano"
          : input.phase === "completed"
            ? "Plano concluído"
            : "Sem plano";

  const progressSection =
    input.phase === "accepted" || input.phase === "executing" || input.phase === "completed"
      ? [
          `<div data-testid="plan-progress" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100" role="progressbar">`,
          `<span data-testid="plan-progress-count">${completedCount}/${totalSteps}</span>`,
          `<span data-testid="plan-progress-ratio">${progressPercent}%</span>`,
          currentStepLabel
            ? `<span data-testid="plan-progress-current">${escapeHtml(currentStepLabel)}</span>`
            : "",
          `</div>`,
        ].join("")
      : "";

  const html = [
    `<section data-testid="plan-progress-panel" data-phase="${escapeHtml(input.phase)}" aria-label="Plano e progresso">`,
    `<h2 data-testid="plan-title">${escapeHtml(input.title)}</h2>`,
    `<p data-testid="plan-id">${escapeHtml(input.planId)}</p>`,
    `<p data-testid="plan-phase">${escapeHtml(phaseLabel)}</p>`,
    `<ol data-testid="plan-steps">`,
    ...input.steps.map((step) => renderStep(step, completedSet, currentStepId)),
    `</ol>`,
    progressSection,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      planId: input.planId,
      title: input.title,
      steps: input.steps,
      phase: input.phase,
      currentStepId,
      currentStepLabel,
      completedStepIds,
      completedCount,
      totalSteps,
      progressRatio,
    },
  };
}
