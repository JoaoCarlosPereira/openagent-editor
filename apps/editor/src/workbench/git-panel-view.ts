import type { IntegratedGitPanel } from "./git-panel.js";

export interface GitPanelViewInput {
  panel: IntegratedGitPanel | null;
}

export interface GitPanelViewSnapshot {
  html: string;
  accessible: {
    open: boolean;
    statusCommand: string | null;
    statusExitCode: number | null;
    statusLength: number;
    diffCommand: string | null;
    diffRelativePath: string | null;
    diffExitCode: number | null;
    diffLength: number;
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

/** LOC-01 (123): painel observável de Git status/diff. */
export function buildGitPanelView(input: GitPanelViewInput): GitPanelViewSnapshot {
  const panel = input.panel;
  const open = panel !== null;
  const focusOrder = open
    ? ([
        "workbench-slot-git",
        "git-status",
        "git-diff",
        "git-refresh-status",
        "git-load-diff",
      ] as const)
    : (["workbench-slot-git"] as const);

  const body = open
    ? [
        `<pre data-testid="git-status" aria-label="Status Git" tabindex="0"`,
        ` data-status-command="${escapeHtml(panel.statusCommand)}"`,
        ` data-status-exit-code="${panel.statusExitCode === null ? "" : String(panel.statusExitCode)}">`,
        `${escapeHtml(panel.statusStdout)}</pre>`,
        `<pre data-testid="git-diff" aria-label="Diff Git" tabindex="0"`,
        ` data-diff-command="${escapeHtml(panel.diffCommand ?? "")}"`,
        ` data-diff-relative-path="${escapeHtml(panel.diffRelativePath ?? "")}"`,
        ` data-diff-exit-code="${panel.diffExitCode === null ? "" : String(panel.diffExitCode)}">`,
        `${escapeHtml(panel.diffStdout)}</pre>`,
        `<button type="button" data-testid="git-refresh-status" tabindex="0">Atualizar status</button>`,
        `<button type="button" data-testid="git-load-diff" tabindex="0">Carregar diff</button>`,
        panel.diffCommand !== null
          ? `<span data-testid="git-last-diff-command" aria-live="polite">${escapeHtml(panel.diffCommand)}</span>`
          : `<span data-testid="git-last-diff-command" aria-live="polite"></span>`,
      ].join("")
    : `<p data-testid="git-empty" aria-live="polite">Abra o painel Git na pasta do workspace</p>`;

  const html = [
    `<section role="region" aria-label="git"`,
    ` data-testid="workbench-slot-git" data-capability="git"`,
    ` data-git-panel="workbench-integrated-git"`,
    ` data-git-open="${open ? "true" : "false"}" tabindex="0">`,
    `<h3 data-testid="git-heading">git</h3>`,
    body,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      open,
      statusCommand: open ? panel.statusCommand : null,
      statusExitCode: open ? panel.statusExitCode : null,
      statusLength: open ? panel.statusStdout.length : 0,
      diffCommand: open ? panel.diffCommand : null,
      diffRelativePath: open ? panel.diffRelativePath : null,
      diffExitCode: open ? panel.diffExitCode : null,
      diffLength: open ? panel.diffStdout.length : 0,
      focusOrder,
    },
  };
}
