import type { UserInput } from "@openagent/protocol";

/** AGT-06: item da fila durante execução (só pending é removível). */
export type RunQueueItemUiState = "pending" | "started";

export interface RunQueueItemRow {
  queueItemId: string;
  ordinal: number;
  state: RunQueueItemUiState;
  previewText: string;
  input: UserInput;
}

export interface RunQueuePanelViewInput {
  runId: string;
  runLifecycle: "idle" | "running";
  items: readonly RunQueueItemRow[];
}

export interface RunQueuePanelViewSnapshot {
  html: string;
  accessible: {
    runId: string;
    runLifecycle: "idle" | "running";
    items: readonly RunQueueItemRow[];
    pendingCount: number;
    startedCount: number;
    removableQueueItemIds: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stateLabel(state: RunQueueItemUiState): string {
  switch (state) {
    case "pending":
      return "Na fila";
    case "started":
      return "Iniciado";
  }
}

function renderItem(item: RunQueueItemRow): string {
  const canRemove = item.state === "pending";
  const removeControl = canRemove
    ? [
        `<button type="button" data-testid="run-queue-remove"`,
        ` data-queue-item-id="${escapeHtml(item.queueItemId)}"`,
        ` aria-label="Remover da fila: ${escapeHtml(item.previewText)}">Remover</button>`,
      ].join("")
    : "";

  return [
    `<li data-testid="run-queue-item"`,
    ` data-queue-item-id="${escapeHtml(item.queueItemId)}"`,
    ` data-ordinal="${item.ordinal}"`,
    ` data-state="${escapeHtml(item.state)}">`,
    `<span data-testid="run-queue-ordinal">#${item.ordinal}</span>`,
    `<span data-testid="run-queue-preview">${escapeHtml(item.previewText)}</span>`,
    `<span data-testid="run-queue-state">${escapeHtml(stateLabel(item.state))}</span>`,
    removeControl,
    `</li>`,
  ].join("");
}

export function previewTextFromUserInput(input: UserInput): string {
  const trimmed = input.text?.trim() ?? "";
  if (trimmed.length > 0) {
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }
  const attachmentCount = input.attachments?.length ?? 0;
  if (attachmentCount > 0) {
    return `${attachmentCount} anexo(s)`;
  }
  return "(sem texto)";
}

/** AGT-06: fila visível com remoção só de itens ainda não iniciados. */
export function buildRunQueuePanelView(
  input: RunQueuePanelViewInput,
): RunQueuePanelViewSnapshot {
  const items = input.items;
  const pendingCount = items.filter((item) => item.state === "pending").length;
  const startedCount = items.filter((item) => item.state === "started").length;
  const removableQueueItemIds = items
    .filter((item) => item.state === "pending")
    .map((item) => item.queueItemId);

  const list =
    items.length === 0
      ? `<p data-testid="run-queue-empty">Nenhuma mensagem na fila</p>`
      : [
          `<ol data-testid="run-queue-list">`,
          ...items.map(renderItem),
          `</ol>`,
        ].join("");

  const html = [
    `<section data-testid="run-queue-panel" aria-label="Fila do agente"`,
    ` data-run-id="${escapeHtml(input.runId)}"`,
    ` data-run-lifecycle="${escapeHtml(input.runLifecycle)}">`,
    `<h2 data-testid="run-queue-title">Fila</h2>`,
    `<p data-testid="run-queue-counts">${pendingCount} na fila · ${startedCount} iniciados</p>`,
    list,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      runId: input.runId,
      runLifecycle: input.runLifecycle,
      items,
      pendingCount,
      startedCount,
      removableQueueItemIds,
    },
  };
}
