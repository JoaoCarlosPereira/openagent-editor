import type { FileTreeEntry } from "./file-tree.js";

export interface FileTreeViewInput {
  folderPath: string | null;
  /** Entradas visíveis (raiz + filhos de diretórios expandidos, na ordem de renderização). */
  entries: readonly FileTreeEntry[];
  /** Caminhos relativos de diretórios expandidos. */
  expandedDirectories: readonly string[];
}

export interface FileTreeViewSnapshot {
  html: string;
  accessible: {
    folderPath: string | null;
    entryCount: number;
    expandedDirectories: readonly string[];
    focusOrder: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderEntry(entry: FileTreeEntry, expanded: ReadonlySet<string>): string {
  const expandedAttr =
    entry.kind === "directory"
      ? ` data-expanded="${expanded.has(entry.relativePath) ? "true" : "false"}"`
      : "";
  return [
    `<li role="treeitem" data-testid="file-tree-entry"`,
    ` data-kind="${entry.kind}" data-path="${escapeHtml(entry.relativePath)}"`,
    `${expandedAttr} tabindex="0">`,
    `<span data-testid="file-tree-entry-name">${escapeHtml(entry.name)}</span>`,
    `</li>`,
  ].join("");
}

/** LOC-01 (120): painel observável da árvore de arquivos da pasta aberta. */
export function buildFileTreeView(input: FileTreeViewInput): FileTreeViewSnapshot {
  const expanded = new Set(input.expandedDirectories);
  const folderLabel = input.folderPath ?? "Nenhuma pasta aberta";
  const open = input.folderPath !== null;
  const focusOrder = ["workbench-file-tree", "file-tree-root-label"] as const;

  const entriesHtml = open
    ? input.entries.map((entry) => renderEntry(entry, expanded)).join("")
    : "";

  const body = open
    ? [
        `<p data-testid="file-tree-root-label" tabindex="0">${escapeHtml(folderLabel)}</p>`,
        `<ul role="tree" data-testid="file-tree-list" aria-label="Árvore de arquivos">`,
        entriesHtml,
        `</ul>`,
      ].join("")
    : `<p data-testid="file-tree-empty" aria-live="polite">Abra uma pasta para ver a árvore</p>`;

  const html = [
    `<aside role="navigation" aria-label="Explorador de arquivos"`,
    ` data-testid="workbench-file-tree" data-folder-open="${open ? "true" : "false"}"`,
    ` data-entry-count="${open ? String(input.entries.length) : "0"}">`,
    `<h2 data-testid="file-tree-heading">Arquivos</h2>`,
    body,
    `</aside>`,
  ].join("");

  return {
    html,
    accessible: {
      folderPath: input.folderPath,
      entryCount: open ? input.entries.length : 0,
      expandedDirectories: [...input.expandedDirectories],
      focusOrder,
    },
  };
}
