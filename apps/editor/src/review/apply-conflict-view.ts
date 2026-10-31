/** ERR-01: visualização das duas versões sem aplicar por cima. */
export interface ApplyConflictViewEntry {
  relativePath: string;
  currentContent: string;
  proposedContent: string;
}

export interface ApplyConflictViewInput {
  message: string;
  entries: readonly ApplyConflictViewEntry[];
}

export interface ApplyConflictViewSnapshot {
  html: string;
  accessible: {
    message: string;
    canApplyDirectly: false;
    entries: readonly ApplyConflictViewEntry[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderConflictEntry(entry: ApplyConflictViewEntry): string {
  return [
    `<article data-testid="apply-conflict-entry" data-path="${escapeHtml(entry.relativePath)}">`,
    `<h3 data-testid="apply-conflict-path">${escapeHtml(entry.relativePath)}</h3>`,
    `<section data-testid="apply-conflict-current" aria-label="Versão atual no disco">`,
    `<pre data-testid="apply-conflict-current-body">${escapeHtml(entry.currentContent)}</pre>`,
    `</section>`,
    `<section data-testid="apply-conflict-proposed" aria-label="Versão proposta pelo agente">`,
    `<pre data-testid="apply-conflict-proposed-body">${escapeHtml(entry.proposedContent)}</pre>`,
    `</section>`,
    `</article>`,
  ].join("");
}

export function buildApplyConflictView(input: ApplyConflictViewInput): ApplyConflictViewSnapshot {
  const entries = input.entries;
  const entryBlocks = entries.map(renderConflictEntry).join("");

  const html = [
    `<section role="alertdialog" aria-modal="true" data-testid="apply-conflict" aria-label="Conflito de versão">`,
    `<p data-testid="apply-conflict-message">${escapeHtml(input.message)}</p>`,
    entryBlocks,
    `<button type="button" disabled aria-disabled="true" data-testid="apply-conflict-apply">Aplicar alterações</button>`,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      message: input.message,
      canApplyDirectly: false,
      entries,
    },
  };
}
