import { randomUUID } from "node:crypto";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type ProjectAcceptParams,
  type ProjectCreateParams,
  type ProjectRejectParams,
} from "@openagent/protocol";
import {
  buildProjectsLocalView,
  type ProjectLocalPhase,
  type ProjectNodeStatus,
  type ProjectNodeView,
  type ProjectsLocalViewSnapshot,
} from "./projects-local-view.js";

export interface ProjectTaskResult {
  nodeId: string;
  title: string;
  result: string;
}

/** Porta RPC do coordenador local: params e resultados exatamente como project.create/accept/reject do protocolo. */
export interface ProjectsLocalPort {
  create(input: { method: typeof RPC_METHOD.PROJECT_CREATE; params: ProjectCreateParams }): Promise<{ projectId: string }>;
  accept(input: { method: typeof RPC_METHOD.PROJECT_ACCEPT; params: ProjectAcceptParams }): Promise<{ accepted: true }>;
  reject(input: { method: typeof RPC_METHOD.PROJECT_REJECT; params: ProjectRejectParams }): Promise<{ rejected: true }>;
}

/** Coordenador local: alem da porta RPC, expoe as tarefas produzidas por um projeto (fora do contrato RPC). */
export interface ProjectsLocalCoordinator extends ProjectsLocalPort {
  tasksOf(projectId: string): Promise<readonly ProjectTaskResult[]>;
}

export const PROJECT_OBJECTIVE_MAX_LENGTH = 2000;

/** Divide o objetivo em tarefas: uma por linha ou por ';', ignorando marcadores de lista. */
export function decomposeObjective(objective: string): string[] {
  const parts = objective
    .split(/[\n;]+/)
    .map((part) => part.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [objective.trim()];
}

function invalid(message: string, fields: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...fields]);
}

/** Codigo exibido na view: o do ProtocolError; so falhas nao tipadas (sem codigo) caem em INVALID_STATE. */
function codeOf(error: unknown): string {
  return error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE;
}

type NodeDecision = "awaiting_review" | "accepted" | "rejected";

/** Coordenador local em memoria: cada tarefa roda como agente na mesma maquina via executor injetavel. */
export class LocalProjectCoordinator implements ProjectsLocalCoordinator {
  private readonly projects = new Map<string, readonly ProjectTaskResult[]>();
  private readonly decisions = new Map<string, NodeDecision>();

  constructor(private readonly runTask: (title: string) => Promise<string> = async (title) => `Resultado local: ${title}`) {}

  async create(input: { method: typeof RPC_METHOD.PROJECT_CREATE; params: ProjectCreateParams }): Promise<{ projectId: string }> {
    const projectId = `project-${randomUUID()}`;
    const tasks: ProjectTaskResult[] = [];
    for (const [index, title] of decomposeObjective(input.params.objective).entries()) {
      tasks.push({ nodeId: `${projectId}-node-${index + 1}`, title, result: await this.runTask(title) });
    }
    this.projects.set(projectId, tasks);
    for (const task of tasks) this.decisions.set(task.nodeId, "awaiting_review");
    return { projectId };
  }

  async tasksOf(projectId: string): Promise<readonly ProjectTaskResult[]> {
    const tasks = this.projects.get(projectId);
    if (!tasks) throw invalid("Projeto desconhecido.", ["projectId"]);
    return tasks.map((task) => ({ ...task }));
  }

  async accept(input: { method: typeof RPC_METHOD.PROJECT_ACCEPT; params: ProjectAcceptParams }): Promise<{ accepted: true }> {
    this.decide(input.params.nodeId, "accepted");
    return { accepted: true };
  }

  async reject(input: { method: typeof RPC_METHOD.PROJECT_REJECT; params: ProjectRejectParams }): Promise<{ rejected: true }> {
    this.decide(input.params.nodeId, "rejected");
    return { rejected: true };
  }

  private decide(nodeId: string, next: Exclude<NodeDecision, "awaiting_review">): void {
    if (this.decisions.get(nodeId) !== "awaiting_review") {
      throw invalid("Resultado do projeto nao esta aguardando revisao.", ["nodeId"]);
    }
    this.decisions.set(nodeId, next);
  }
}

export class ProjectsLocalController {
  private phase: ProjectLocalPhase = "idle";
  private projectId: string | null = null;
  private objective: string | null = null;
  private nodes: ProjectNodeView[] = [];
  private code: string | null = null;
  private readonly inFlight = new Set<string>();

  constructor(private readonly coordinator: ProjectsLocalCoordinator = new LocalProjectCoordinator()) {
    const c = coordinator as Partial<ProjectsLocalCoordinator> | null | undefined;
    if (!c || typeof c.create !== "function" || typeof c.accept !== "function" || typeof c.reject !== "function" || typeof c.tasksOf !== "function") {
      throw invalid("Coordenador de projetos locais invalido.", ["coordinator"]);
    }
  }

  get snapshot(): ProjectsLocalViewSnapshot {
    return buildProjectsLocalView({ phase: this.phase, projectId: this.projectId, objective: this.objective, nodes: this.nodes, errorCode: this.code });
  }

  async createProject(objective: string): Promise<ProjectsLocalViewSnapshot> {
    if (this.phase !== "idle") throw invalid("Criacao de projeto fora de estado valido.", ["state"]);
    const trimmed = typeof objective === "string" ? objective.trim() : "";
    if (trimmed.length === 0 || trimmed.length > PROJECT_OBJECTIVE_MAX_LENGTH) {
      throw invalid("Objetivo do projeto invalido.", ["objective"]);
    }
    this.phase = "creating";
    this.code = null;
    try {
      const { projectId } = await this.coordinator.create({ method: RPC_METHOD.PROJECT_CREATE, params: { objective: trimmed } });
      const tasks = await this.coordinator.tasksOf(projectId);
      if (tasks.length === 0) throw invalid("Coordenador nao produziu tarefas.", ["tasks"]);
      this.projectId = projectId;
      this.objective = trimmed;
      this.nodes = tasks.map((task) => ({ nodeId: task.nodeId, title: task.title, result: task.result, status: "awaiting_review" }));
      this.phase = "review";
    } catch (error) {
      this.phase = "idle";
      this.code = codeOf(error);
      throw error;
    }
    return this.snapshot;
  }

  accept(nodeId: string): Promise<ProjectsLocalViewSnapshot> {
    return this.decide(nodeId, "accepted");
  }

  reject(nodeId: string): Promise<ProjectsLocalViewSnapshot> {
    return this.decide(nodeId, "rejected");
  }

  private async decide(nodeId: string, status: Exclude<ProjectNodeStatus, "awaiting_review">): Promise<ProjectsLocalViewSnapshot> {
    if (this.phase !== "review" || !this.projectId) throw invalid("Nao ha projeto aguardando revisao.", ["state"]);
    const node = typeof nodeId === "string" ? this.nodes.find((n) => n.nodeId === nodeId) : undefined;
    if (!node) throw invalid("Resultado do projeto desconhecido.", ["nodeId"]);
    if (node.status !== "awaiting_review" || this.inFlight.has(nodeId)) throw invalid("Resultado do projeto ja foi decidido.", ["nodeId"]);
    this.inFlight.add(nodeId);
    try {
      if (status === "accepted") await this.coordinator.accept({ method: RPC_METHOD.PROJECT_ACCEPT, params: { nodeId } });
      else await this.coordinator.reject({ method: RPC_METHOD.PROJECT_REJECT, params: { nodeId } });
    } catch (error) {
      this.code = codeOf(error);
      throw error;
    } finally {
      this.inFlight.delete(nodeId);
    }
    node.status = status;
    this.code = null;
    if (this.nodes.every((n) => n.status !== "awaiting_review")) this.phase = "completed";
    return this.snapshot;
  }
}
