/** SES-03: UI de restauração de checkpoint (sucesso só do run ou conflito sem sobrescrita). */

export type CheckpointRestorePhase = "idle" | "restored" | "conflict";

export interface CheckpointRestoreConflictEntry {
  relativePath: string;
  currentContent: string;
  proposedContent: string;
}

export interface CheckpointRestoreViewInput {
  phase: CheckpointRestorePhase;
  checkpointId: string | null;
  message: string;
  restoredPaths: readonly string[];
  conflicts: readonly CheckpointRestoreConflictEntry[];
}

export interface CheckpointRestoreViewSnapshot {
  html: string;
  accessible: {
    phase: CheckpointRestorePhase;
    checkpointId: string | null;
    message: string;
    restoredPaths: readonly string[];
    conflicts: readonly CheckpointRestoreConflictEntry[];
    canOverwrite: false;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderRestoredPaths(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const items = paths
    .map(
      (path) =>
        `<li data-testid="checkpoint-restore-path" data-path="${escapeHtml(path)}">${escapeHtml(path)}</li>`,
    )
    .join("");
  return `<ul data-testid="checkpoint-restore-paths">${items}</ul>`;
}

function renderConflictEntry(entry: CheckpointRestoreConflictEntry): string {
  return [
    `<article data-testid="checkpoint-restore-conflict-entry" data-path="${escapeHtml(entry.relativePath)}">`,
    `<h3 data-testid="checkpoint-restore-conflict-path">${escapeHtml(entry.relativePath)}</h3>`,
    `<section data-testid="checkpoint-restore-current" aria-label="Versão atual no disco">`,
    `<pre data-testid="checkpoint-restore-current-body">${escapeHtml(entry.currentContent)}</pre>`,
    `</section>`,
    `<section data-testid="checkpoint-restore-proposed" aria-label="Versão do checkpoint">`,
    `<pre data-testid="checkpoint-restore-proposed-body">${escapeHtml(entry.proposedContent)}</pre>`,
    `</section>`,
    `</article>`,
  ].join("");
}

export function buildCheckpointRestoreView(
  input: CheckpointRestoreViewInput,
): CheckpointRestoreViewSnapshot {
  const conflictBlocks = input.conflicts.map(renderConflictEntry).join("");
  const overwriteControl =
    input.phase === "conflict"
      ? `<button type="button" disabled aria-disabled="true" data-testid="checkpoint-restore-overwrite">Sobrescrever</button>`
      : "";
  const restoreControl =
    input.phase === "idle"
      ? `<button type="button" data-testid="checkpoint-restore-action">Restaurar checkpoint</button>`
      : "";

  const html = [
    `<section role="region" data-testid="checkpoint-restore" data-phase="${escapeHtml(input.phase)}" aria-label="Restaurar checkpoint">`,
    input.checkpointId
      ? `<span data-testid="checkpoint-restore-id">${escapeHtml(input.checkpointId)}</span>`
      : "",
    `<p data-testid="checkpoint-restore-message">${escapeHtml(input.message)}</p>`,
    renderRestoredPaths(input.restoredPaths),
    conflictBlocks,
    restoreControl,
    overwriteControl,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      phase: input.phase,
      checkpointId: input.checkpointId,
      message: input.message,
      restoredPaths: input.restoredPaths,
      conflicts: input.conflicts,
      canOverwrite: false,
    },
  };
}
