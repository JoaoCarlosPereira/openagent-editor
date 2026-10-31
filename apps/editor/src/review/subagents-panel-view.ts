/** AGT-05/AGT-07: subagentes locais visíveis com nome, estado e resultado próprios. */

export type SubagentUiState = "running" | "complete" | "cancelled";

export interface SubagentRow {
  agentId: string;
  name: string;
  state: SubagentUiState;
  resultRef: string | null;
  resultSummary: string | null;
}

export interface SubagentsPanelViewInput {
  agents: readonly SubagentRow[];
}

export interface SubagentsPanelViewSnapshot {
  html: string;
  accessible: {
    agents: readonly SubagentRow[];
    runningCount: number;
    cancelledCount: number;
    completeCount: number;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stateLabel(state: SubagentUiState): string {
  switch (state) {
    case "running":
      return "Em execução";
    case "complete":
      return "Concluído";
    case "cancelled":
      return "Cancelado";
  }
}

function renderAgent(agent: SubagentRow): string {
  const canCancel = agent.state === "running";
  const resultBlock =
    agent.state === "complete"
      ? [
          `<div data-testid="subagent-result">`,
          agent.resultRef
            ? `<span data-testid="subagent-result-ref">${escapeHtml(agent.resultRef)}</span>`
            : "",
          agent.resultSummary
            ? `<p data-testid="subagent-result-summary">${escapeHtml(agent.resultSummary)}</p>`
            : `<p data-testid="subagent-result-summary">Sem resumo</p>`,
          `</div>`,
        ].join("")
      : agent.state === "cancelled"
        ? `<p data-testid="subagent-cancelled-notice">Interrompido sem alterar os demais</p>`
        : "";

  const cancelControl = canCancel
    ? `<button type="button" data-testid="subagent-cancel" data-agent-id="${escapeHtml(agent.agentId)}" aria-label="Cancelar subagente ${escapeHtml(agent.name)}">Cancelar</button>`
    : "";

  return [
    `<li data-testid="subagent-row" data-agent-id="${escapeHtml(agent.agentId)}" data-state="${escapeHtml(agent.state)}">`,
    `<span data-testid="subagent-name">${escapeHtml(agent.name)}</span>`,
    `<span data-testid="subagent-state">${escapeHtml(stateLabel(agent.state))}</span>`,
    cancelControl,
    resultBlock,
    `</li>`,
  ].join("");
}

export function buildSubagentsPanelView(
  input: SubagentsPanelViewInput,
): SubagentsPanelViewSnapshot {
  const agents = input.agents;
  const runningCount = agents.filter((a) => a.state === "running").length;
  const cancelledCount = agents.filter((a) => a.state === "cancelled").length;
  const completeCount = agents.filter((a) => a.state === "complete").length;

  const list =
    agents.length === 0
      ? `<p data-testid="subagents-empty">Nenhum subagente neste run</p>`
      : [
          `<ul data-testid="subagents-list">`,
          ...agents.map(renderAgent),
          `</ul>`,
        ].join("");

  const html = [
    `<section data-testid="subagents-panel" aria-label="Subagentes locais">`,
    `<h2 data-testid="subagents-title">Subagentes</h2>`,
    `<p data-testid="subagents-counts">${runningCount} em execução · ${completeCount} concluídos · ${cancelledCount} cancelados</p>`,
    list,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      agents,
      runningCount,
      cancelledCount,
      completeCount,
    },
  };
}
