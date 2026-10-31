/** AGT-03: diff agrupado e resultado por ferramenta no painel do agente. */
export interface AgentToolResultRow {
  invocationId: string;
  tool: string;
  action: string;
  target: string;
  state: string;
  summary: string;
  detail: string;
}

export interface AgentRunReviewViewInput {
  groupedDiff?: string;
  fileCount?: number;
  toolResults: readonly AgentToolResultRow[];
}

export interface AgentRunReviewViewSnapshot {
  html: string;
  accessible: {
    groupedDiff: string;
    fileCount: number | null;
    toolResults: readonly AgentToolResultRow[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderToolResultRow(row: AgentToolResultRow): string {
  return [
    `<li data-testid="agent-tool-result" data-tool="${escapeHtml(row.tool)}" data-invocation-id="${escapeHtml(row.invocationId)}">`,
    `<span data-testid="agent-tool-result-action">${escapeHtml(row.action)}</span>`,
    `<span data-testid="agent-tool-result-target">${escapeHtml(row.target)}</span>`,
    `<span data-testid="agent-tool-result-state">${escapeHtml(row.state)}</span>`,
    `<span data-testid="agent-tool-result-summary">${escapeHtml(row.summary)}</span>`,
    `<pre data-testid="agent-tool-result-detail">${escapeHtml(row.detail)}</pre>`,
    `</li>`,
  ].join("");
}

export function buildAgentRunReviewView(
  input: AgentRunReviewViewInput,
): AgentRunReviewViewSnapshot {
  const groupedDiff = input.groupedDiff ?? "";
  const fileCount = input.fileCount ?? null;
  const diffSection =
    groupedDiff.length > 0
      ? [
          `<section data-testid="agent-grouped-diff">`,
          fileCount !== null
            ? `<p data-testid="agent-grouped-diff-file-count">${fileCount} arquivo(s)</p>`
            : "",
          `<pre data-testid="agent-grouped-diff-body">${escapeHtml(groupedDiff)}</pre>`,
          `</section>`,
        ].join("")
      : "";

  const toolList =
    input.toolResults.length > 0
      ? [
          `<ul data-testid="agent-tool-results">`,
          ...input.toolResults.map(renderToolResultRow),
          `</ul>`,
        ].join("")
      : `<ul data-testid="agent-tool-results"></ul>`;

  const html = [
    `<section data-testid="agent-run-review" aria-label="Revisão da execução do agente">`,
    diffSection,
    toolList,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      groupedDiff,
      fileCount,
      toolResults: input.toolResults,
    },
  };
}
