/**
 * CAN-01: view observável do painel de canvas no editor —
 * canvas aberto pelo agente exibido no painel e mantido visível
 * depois do fim da resposta.
 */

/** Ordem de foco (IPv-AGPN-15): conteúdo do canvas, histórico, fechar. */
export const CANVAS_PANEL_FOCUS_TARGETS = [
  "canvas-open-view",
  "canvas-history-list",
  "canvas-close-button",
] as const;

export type CanvasPanelFocusTarget = (typeof CANVAS_PANEL_FOCUS_TARGETS)[number];

export type CanvasPanelUiPhase = "idle" | "loading" | "open" | "closed";

export interface CanvasPanelArtifactRow {
  id: string;
  title: string;
  /** Conteúdo completo do canvas (texto exibido no painel aberto). */
  content: string;
  /** true = canvas aberto durante a execução atual; senão veio do histórico. */
  openedThisRun: boolean;
}

export interface CanvasPanelViewInput {
  runId: string;
  sessionId: string;
  phase: CanvasPanelUiPhase;
  /** Canvas visível no painel (ativo). null = nenhum canvas exibido. */
  activeArtifact: CanvasPanelArtifactRow | null;
  /** Histórico persistido de canvas desta sessão (ordem de abertura). */
  artifacts: readonly CanvasPanelArtifactRow[];
  /** true quando a resposta da execução já terminou (run.completed). */
  responseEnded: boolean;
  focused: CanvasPanelFocusTarget;
  errorMessage: string | null;
}

export interface CanvasPanelViewSnapshot {
  html: string;
  accessible: {
    runId: string;
    sessionId: string;
    phase: CanvasPanelUiPhase;
    phaseLabel: string;
    responseEnded: boolean;
    canvasOpen: boolean;
    activeCanvasId: string | null;
    activeCanvasTitle: string | null;
    activeCanvasContentPresent: boolean;
    artifactCount: number;
    artifactIds: readonly string[];
    errorMessage: string | null;
    focused: CanvasPanelFocusTarget;
    /** IPv-AGPN-15: canvas aberto é focável e navegável por teclado. */
    canFocusCanvas: boolean;
  };
}

export function canvasPanelStatusLabel(phase: CanvasPanelUiPhase): string {
  switch (phase) {
    case "idle":
      return "Nenhum canvas aberto nesta execução";
    case "loading":
      return "Abrindo canvas do agente";
    case "open":
      return "Canvas exibido no painel";
    case "closed":
      return "Canvas fechado: conteúdo permanece no histórico";
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderArtifact(artifact: CanvasPanelArtifactRow): string {
  return [
    `<article data-testid="canvas-artifact"`,
    ` data-canvas-id="${escapeHtml(artifact.id)}"`,
    ` aria-label="Canvas ${escapeHtml(artifact.title)}" tabindex="0">`,
    `<h3 data-testid="canvas-title">${escapeHtml(artifact.title)}</h3>`,
    `<pre data-testid="canvas-content"><code>${escapeHtml(artifact.content)}</code></pre>`,
    `</article>`,
  ].join("");
}
function renderHistoryEntry(title: string, canvasId: string): string {
  return [
    `<li data-testid="canvas-history-entry"`,
    ` data-canvas-id="${escapeHtml(canvasId)}">`,
    `${escapeHtml(title)}</li>`,
  ].join("");
}

/** CAN-01: canvas aberto pelo agente aparece no painel e permanece após a resposta. */
export function buildCanvasPanelView(
  input: CanvasPanelViewInput,
): CanvasPanelViewSnapshot {
  const phaseLabel = canvasPanelStatusLabel(input.phase);

  const viewBox = input.phase === "open" && input.activeArtifact !== null
    ? renderArtifact(input.activeArtifact)
    : input.phase === "loading"
      ? `<p data-testid="canvas-loading">Carregando conteúdo do canvas</p>`
      : `<p data-testid="canvas-empty">Nenhum canvas exibido no painel</p>`;

  const historyBlock = input.artifacts.length === 0
    ? `<p data-testid="canvas-history-empty">Sem canvas no histórico nesta sessão</p>`
    : [
      `<ol data-testid="canvas-history-list" aria-label="Histórico de canvas" tabindex="0">`,
      ...input.artifacts.map((artifact) =>
        renderHistoryEntry(artifact.title, artifact.id)
      ),
      `</ol>`,
    ].join("");

  const closeButtonHtml = input.artifacts.length === 0
    ? ""
    : `<button type="button" data-testid="canvas-close-button" tabindex="0"` +
      ` aria-label="Fechar canvas">Fechar canvas</button>`;

  const html = [
    `<section data-testid="canvas-panel" aria-label="Painel do canvas"`,
    ` data-run-id="${escapeHtml(input.runId)}"`,
    ` data-session-id="${escapeHtml(input.sessionId)}"`,
    ` data-phase="${escapeHtml(input.phase)}"`,
    ` data-response-ended="${input.responseEnded ? "true" : "false"}">`,
    `<h2 data-testid="canvas-panel-title">Canvas</h2>`,
    `<p data-testid="canvas-status" aria-live="polite">${escapeHtml(phaseLabel)}</p>`,
    `<div data-testid="canvas-open-view" tabindex="0">${viewBox}</div>`,
    historyBlock,
    closeButtonHtml,
    input.errorMessage !== null
      ? `<p data-testid="canvas-error" aria-live="assertive">${
        escapeHtml(input.errorMessage)
      }</p>`
      : "",
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      runId: input.runId,
      sessionId: input.sessionId,
      phase: input.phase,
      phaseLabel,
      responseEnded: input.responseEnded,
      canvasOpen: input.phase === "open",
      activeCanvasId: input.activeArtifact?.id ?? null,
      activeCanvasTitle: input.activeArtifact?.title ?? null,
      activeCanvasContentPresent:
        (input.activeArtifact?.content ?? "").length > 0,
      artifactCount: input.artifacts.length,
      artifactIds: input.artifacts.map((artifact) => artifact.id),
      errorMessage: input.errorMessage,
      focused: input.focused,
      canFocusCanvas: input.phase === "open" && input.activeArtifact !== null,
    },
  };
}
