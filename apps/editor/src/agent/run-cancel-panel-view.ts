/** PER-02: status observável da execução e alterações já aplicadas. */

export type RunCancelUiState = "idle" | "running" | "cancelled";

export interface AppliedChangeRow {
  changeId: string;
  path: string;
  summary: string;
}

export interface RunCancelPanelViewInput {
  runId: string;
  runState: RunCancelUiState;
  appliedChanges: readonly AppliedChangeRow[];
  /** Latência cancel→Cancelada em ms (só após cancelled). */
  cancelLatencyMs: number | null;
}

export interface RunCancelPanelViewSnapshot {
  html: string;
  accessible: {
    runId: string;
    runState: RunCancelUiState;
    statusLabel: string;
    canCancel: boolean;
    appliedChangeIds: readonly string[];
    appliedChangeCount: number;
    cancelLatencyMs: number | null;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function runCancelStatusLabel(state: RunCancelUiState): string {
  switch (state) {
    case "idle":
      return "Ociosa";
    case "running":
      return "Em execução";
    case "cancelled":
      return "Cancelada";
  }
}

function renderAppliedChange(change: AppliedChangeRow): string {
  return [
    `<li data-testid="run-applied-change"`,
    ` data-change-id="${escapeHtml(change.changeId)}"`,
    ` data-path="${escapeHtml(change.path)}">`,
    `<span data-testid="run-applied-change-path">${escapeHtml(change.path)}</span>`,
    `<span data-testid="run-applied-change-summary">${escapeHtml(change.summary)}</span>`,
    `</li>`,
  ].join("");
}

/** PER-02: botão Cancelar + estado Cancelada + alterações conservadas. */
export function buildRunCancelPanelView(
  input: RunCancelPanelViewInput,
): RunCancelPanelViewSnapshot {
  const statusLabel = runCancelStatusLabel(input.runState);
  const canCancel = input.runState === "running";
  const appliedChangeIds = input.appliedChanges.map((c) => c.changeId);

  const cancelControl = canCancel
    ? [
        `<button type="button" data-testid="run-cancel-button"`,
        ` aria-label="Cancelar execução">Cancelar</button>`,
      ].join("")
    : "";

  const appliedBlock =
    input.appliedChanges.length === 0
      ? `<p data-testid="run-applied-empty">Nenhuma alteração aplicada</p>`
      : [
          `<ol data-testid="run-applied-list" aria-label="Alterações já aplicadas">`,
          ...input.appliedChanges.map(renderAppliedChange),
          `</ol>`,
        ].join("");

  const latencyAttr =
    input.cancelLatencyMs !== null
      ? ` data-cancel-latency-ms="${input.cancelLatencyMs}"`
      : "";

  const html = [
    `<section data-testid="run-cancel-panel" aria-label="Cancelamento da execução"`,
    ` data-run-id="${escapeHtml(input.runId)}"`,
    ` data-run-state="${escapeHtml(input.runState)}"${latencyAttr}>`,
    `<h2 data-testid="run-cancel-title">Execução</h2>`,
    `<p data-testid="run-cancel-status" aria-live="assertive">`,
    escapeHtml(statusLabel),
    `</p>`,
    cancelControl,
    appliedBlock,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      runId: input.runId,
      runState: input.runState,
      statusLabel,
      canCancel,
      appliedChangeIds,
      appliedChangeCount: input.appliedChanges.length,
      cancelLatencyMs: input.cancelLatencyMs,
    },
  };
}
