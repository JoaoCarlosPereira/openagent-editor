export type AgentExecutionStatus = "active" | "completed" | "failed";

export type AgentsWindowViewMode = "editor" | "agents_window";

export interface AgentParallelExecution {
  agentId: string;
  name: string;
  status: AgentExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
}

export interface AgentsWindowViewInput {
  sessionId: string;
  workspaceId: string;
  currentView: AgentsWindowViewMode;
  executions: readonly AgentParallelExecution[];
  errorMessage: string | null;
}

export interface AgentsWindowViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    workspaceId: string;
    currentView: AgentsWindowViewMode;
    executions: readonly AgentParallelExecution[];
    activeCount: number;
    completedCount: number;
    failedCount: number;
    totalCount: number;
    errorMessage: string | null;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatStatusPtBr(status: AgentExecutionStatus): string {
  switch (status) {
    case "active":
      return "Ativo";
    case "completed":
      return "Concluído";
    case "failed":
      return "Falha";
    default:
      return status;
  }
}

export function buildAgentsWindowView(input: AgentsWindowViewInput): AgentsWindowViewSnapshot {
  const activeCount = input.executions.filter((e) => e.status === "active").length;
  const completedCount = input.executions.filter((e) => e.status === "completed").length;
  const failedCount = input.executions.filter((e) => e.status === "failed").length;
  const totalCount = input.executions.length;

  const errorSection =
    input.errorMessage !== null
      ? `<p role="alert" aria-live="assertive" data-testid="agents-window-error">${escapeHtml(input.errorMessage)}</p>`
      : "";

  let contentHtml: string;

  if (input.currentView === "editor") {
    const summaryIndicator =
      activeCount > 0
        ? `<span data-testid="agents-active-indicator" role="status">${activeCount} agente(s) em execução paralela</span>`
        : `<span data-testid="agents-active-indicator" role="status">Nenhum agente em execução</span>`;

    contentHtml = [
      `<section data-testid="agents-workbench-view"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-workspace-id="${escapeHtml(input.workspaceId)}"`,
      ` data-current-view="editor">`,
      `<h2>Editor — Workspace ${escapeHtml(input.workspaceId)}</h2>`,
      `<button type="button" data-testid="open-agents-window-button" aria-label="Abrir janela de agentes">Abrir janela de agentes</button>`,
      summaryIndicator,
      errorSection,
      `</section>`,
    ].join("");
  } else {
    const statusText =
      totalCount > 0
        ? `${totalCount} execução(ões) local(is) em paralelo: ${activeCount} ativa(s), ${completedCount} concluída(s), ${failedCount} com falha.`
        : "Nenhuma execução de agente em paralelo no momento.";

    const itemsHtml =
      totalCount > 0
        ? input.executions
            .map((e) => {
              const label = formatStatusPtBr(e.status);
              const summaryPart = e.summary
                ? ` — <span data-testid="parallel-agent-summary">${escapeHtml(e.summary)}</span>`
                : "";
              return [
                `<li data-testid="parallel-agent-item"`,
                ` data-agent-id="${escapeHtml(e.agentId)}"`,
                ` data-status="${escapeHtml(e.status)}">`,
                `<strong data-testid="parallel-agent-name">${escapeHtml(e.name)}</strong>`,
                ` (<span data-testid="parallel-agent-status">${escapeHtml(label)}</span>)`,
                summaryPart,
                `</li>`,
              ].join("");
            })
            .join("")
        : `<li data-testid="parallel-agents-empty">Nenhuma execução de agente encontrada no workspace.</li>`;

    contentHtml = [
      `<section data-testid="agents-window-panel"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-workspace-id="${escapeHtml(input.workspaceId)}"`,
      ` data-current-view="agents_window"`,
      ` data-active-count="${activeCount}"`,
      ` data-total-count="${totalCount}">`,
      `<h2>Janela de Agentes — Execuções Paralelas</h2>`,
      `<button type="button" data-testid="return-to-editor-button" aria-label="Voltar ao editor">Voltar ao editor</button>`,
      `<p data-testid="agents-window-status" role="status" aria-live="polite">${escapeHtml(statusText)}</p>`,
      `<ul data-testid="parallel-agents-list" aria-label="Lista de agentes em execução paralela">${itemsHtml}</ul>`,
      errorSection,
      `</section>`,
    ].join("");
  }

  return {
    html: contentHtml,
    accessible: {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      currentView: input.currentView,
      executions: input.executions,
      activeCount,
      completedCount,
      failedCount,
      totalCount,
      errorMessage: input.errorMessage,
    },
  };
}
