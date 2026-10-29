import { randomUUID } from "node:crypto";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
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

/** Porta do coordenador local (espelha project.create/accept/reject do protocolo). */
export interface ProjectsLocalPort {
  create(input: { objective: string }): Promise<{ projectId: string; tasks: readonly ProjectTaskResult[] }>;
  accept(input: { projectId: string; nodeId: string }): Promise<{ accepted: true }>;
  reject(input: { projectId: string; nodeId: string }): Promise<{ rejected: true }>;
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

/** Coordenador local em memoria: cada tarefa roda como agente na mesma maquina via executor injetavel. */
export class LocalProjectCoordinator implements ProjectsLocalPort {
  private readonly projects = new Map<string, Map<string, "awaiting_review" | "accepted" | "rejected">>();

  constructor(private readonly runTask: (title: string) => Promise<string> = async (title) => `Resultado local: ${title}`) {}

  async create(input: { objective: string }): Promise<{ projectId: string; tasks: readonly ProjectTaskResult[] }> {
    const projectId = `project-${randomUUID()}`;
    const tasks: ProjectTaskResult[] = [];
    for (const [index, title] of decomposeObjective(input.objective).entries()) {
      tasks.push({ nodeId: `${projectId}-node-${index + 1}`, title, result: await this.runTask(title) });
    }
    this.projects.set(projectId, new Map(tasks.map((task) => [task.nodeId, "awaiting_review"])));
    return { projectId, tasks };
  }

  async accept(input: { projectId: string; nodeId: string }): Promise<{ accepted: true }> {
    this.decide(input, "accepted");
    return { accepted: true };
  }

  async reject(input: { projectId: string; nodeId: string }): Promise<{ rejected: true }> {
    this.decide(input, "rejected");
    return { rejected: true };
  }

  private decide(input: { projectId: string; nodeId: string }, next: "accepted" | "rejected"): void {
    const nodes = this.projects.get(input.projectId);
    if (!nodes || nodes.get(input.nodeId) !== "awaiting_review") {
      throw invalid("Resultado do projeto nao esta aguardando revisao.", ["nodeId"]);
    }
    nodes.set(input.nodeId, next);
  }
}

export class ProjectsLocalController {
  private phase: ProjectLocalPhase = "idle";
  private projectId: string | null = null;
  private objective: string | null = null;
  private nodes: ProjectNodeView[] = [];
  private code: string | null = null;

  constructor(private readonly port: ProjectsLocalPort = new LocalProjectCoordinator()) {
    if (!port || typeof port.create !== "function" || typeof port.accept !== "function" || typeof port.reject !== "function") {
      throw invalid("Porta de projetos locais invalida.", ["port"]);
    }
  }

  get snapshot(): ProjectsLocalViewSnapshot {
    return buildProjectsLocalView({ phase: this.phase, projectId: this.projectId, objective: this.objective, nodes: this.nodes, errorCode: this.code });
  }

  async createProject(objective: string): Promise<ProjectsLocalViewSnapshot> {
    if (this.phase !== "idle") throw invalid("Criacao de projeto fora de estado valido.", ["state"]);
    if (typeof objective !== "string" || objective.trim().length === 0 || objective.length > PROJECT_OBJECTIVE_MAX_LENGTH) {
      throw invalid("Objetivo do projeto invalido.", ["objective"]);
    }
    const trimmed = objective.trim();
    this.phase = "creating";
    this.code = null;
    try {
      const created = await this.port.create({ objective: trimmed });
      if (created.tasks.length === 0) throw invalid("Coordenador nao produziu tarefas.", ["tasks"]);
      this.projectId = created.projectId;
      this.objective = trimmed;
      this.nodes = created.tasks.map((task) => ({ nodeId: task.nodeId, title: task.title, result: task.result, status: "awaiting_review" }));
      this.phase = "review";
    } catch (error) {
      this.phase = "idle";
      this.code = this.codeOf(error);
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
    if (node.status !== "awaiting_review") throw invalid("Resultado do projeto ja foi decidido.", ["nodeId"]);
    try {
      const input = { projectId: this.projectId, nodeId };
      if (status === "accepted") await this.port.accept(input);
      else await this.port.reject(input);
    } catch (error) {
      this.code = this.codeOf(error);
      throw error;
    }
    node.status = status;
    this.code = null;
    if (this.nodes.every((n) => n.status !== "awaiting_review")) this.phase = "completed";
    return this.snapshot;
  }

  private codeOf(error: unknown): string {
    return error instanceof ProtocolError ? error.code : PROTOCOL_ERROR_CODES.INVALID_STATE;
  }
}

export { buildProjectsLocalView } from "./projects-local-view.js";
export type {
  ProjectLocalPhase,
  ProjectNodeStatus,
  ProjectNodeView,
  ProjectsLocalViewSnapshot,
} from "./projects-local-view.js";
