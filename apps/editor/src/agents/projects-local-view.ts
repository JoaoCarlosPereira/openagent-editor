export type ProjectLocalPhase = "idle" | "creating" | "review" | "completed";

export type ProjectNodeStatus = "awaiting_review" | "accepted" | "rejected";

export interface ProjectNodeView {
  nodeId: string;
  title: string;
  result: string;
  status: ProjectNodeStatus;
}

export interface ProjectsLocalViewInput {
  phase: ProjectLocalPhase;
  projectId: string | null;
  objective: string | null;
  nodes: readonly ProjectNodeView[];
  errorCode: string | null;
}

export interface ProjectsLocalViewSnapshot {
  html: string;
  accessible: {
    phase: ProjectLocalPhase;
    projectId: string | null;
    objective: string | null;
    nodes: readonly ProjectNodeView[];
    pendingCount: number;
    acceptedCount: number;
    rejectedCount: number;
    errorCode: string | null;
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const STATUS_LABEL: Record<ProjectNodeStatus, string> = {
  awaiting_review: "Aguardando revisão",
  accepted: "Aceito",
  rejected: "Rejeitado",
};

function buildNodeItem(node: ProjectNodeView, canDecide: boolean): string {
  const id = escapeHtml(node.nodeId);
  const actions = canDecide && node.status === "awaiting_review"
    ? `<button type="button" data-testid="project-node-accept" data-node-id="${id}">Aceitar</button><button type="button" data-testid="project-node-reject" data-node-id="${id}">Rejeitar</button>`
    : "";
  return `<li data-testid="project-node" data-node-id="${id}" data-status="${node.status}"><h3>${escapeHtml(node.title)}</h3><pre data-testid="project-node-result">${escapeHtml(node.result)}</pre><p data-testid="project-node-status">${STATUS_LABEL[node.status]}</p>${actions}</li>`;
}

export function buildProjectsLocalView(input: ProjectsLocalViewInput): ProjectsLocalViewSnapshot {
  const pendingCount = input.nodes.filter((n) => n.status === "awaiting_review").length;
  const acceptedCount = input.nodes.filter((n) => n.status === "accepted").length;
  const rejectedCount = input.nodes.filter((n) => n.status === "rejected").length;
  const idle = input.phase === "idle";
  const form = `<label for="project-objective">Objetivo</label><input id="project-objective" data-testid="project-objective" value="${escapeHtml(input.objective ?? "")}" ${idle ? "" : "disabled"}/>${idle ? '<button type="button" data-testid="project-create">Criar projeto</button>' : ""}`;
  const items = input.nodes.map((n) => buildNodeItem(n, input.phase === "review")).join("");
  const error = input.errorCode ? `<p role="alert" data-testid="project-error" data-code="${escapeHtml(input.errorCode)}">${escapeHtml(input.errorCode)}</p>` : "";
  return {
    html: `<section data-testid="projects-local-panel" data-phase="${input.phase}"><h2>Projects local</h2>${form}<p data-testid="project-status" role="status">Estado: ${input.phase}</p><ul data-testid="project-nodes">${items}</ul>${error}</section>`,
    accessible: {
      phase: input.phase,
      projectId: input.projectId,
      objective: input.objective,
      nodes: input.nodes.map((n) => ({ ...n })),
      pendingCount,
      acceptedCount,
      rejectedCount,
      errorCode: input.errorCode,
    },
  };
}
