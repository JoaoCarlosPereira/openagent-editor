import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import {
  buildAgentsWindowView,
  type AgentExecutionStatus,
  type AgentParallelExecution,
  type AgentsWindowViewMode,
  type AgentsWindowViewSnapshot,
} from "./agents-window-view.js";

export type {
  AgentExecutionStatus,
  AgentParallelExecution,
  AgentsWindowViewMode,
  AgentsWindowViewSnapshot,
} from "./agents-window-view.js";
export { buildAgentsWindowView } from "./agents-window-view.js";

/** Opções opcionais para a transição de visualização entre editor e janela de agentes. */
export interface AgentsWindowNavigationOptions {
  targetWorkspaceId?: string;
  allowedWorkspaceId?: string;
}

/** Porta injetável para consultar execuções paralelas de agentes do workspace. */
export interface AgentsWindowPort {
  listParallelExecutions(input: {
    workspaceId: string;
  }): Promise<readonly AgentParallelExecution[]>;
}

export type AgentsWindowListener = (snapshot: AgentsWindowViewSnapshot) => void;

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function outOfScope(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.OUT_OF_SCOPE, message, [...details]);
}

const VALID_STATUSES: readonly AgentExecutionStatus[] = ["active", "completed", "failed"];

function validateExecutionItem(item: AgentParallelExecution): void {
  if (!item || typeof item !== "object") {
    throw invalidState("Item de execução paralela inválido.");
  }
  if (typeof item.agentId !== "string" || item.agentId.trim().length === 0) {
    throw invalidState("agentId da execução paralela é obrigatório e não pode ser vazio.", ["agentId"]);
  }
  if (typeof item.name !== "string" || item.name.trim().length === 0) {
    throw invalidState("name da execução paralela é obrigatório e não pode ser vazio.", ["name"]);
  }
  if (!VALID_STATUSES.includes(item.status)) {
    throw invalidState(
      `status '${item.status}' inválido. Valores aceitos: ${VALID_STATUSES.join(", ")}.`,
      ["status"],
    );
  }
}

/**
 * UI-04: Janela de agentes com execuções paralelas e volta ao editor.
 *
 * Quando a pessoa abrir a janela de agentes, o produto lista as execuções locais
 * em paralelo e oferece o comando de voltar ao editor no mesmo workspace.
 */
export class AgentsWindowController {
  private readonly sessionIdValue: string;
  private readonly workspaceIdValue: string;
  private currentViewMode: AgentsWindowViewMode;
  private executionsList: AgentParallelExecution[] = [];
  private errorMessage: string | null = null;
  private view: AgentsWindowViewSnapshot;
  private readonly listeners = new Set<AgentsWindowListener>();

  constructor(
    sessionId: string,
    workspaceId: string,
    initialExecutions: readonly AgentParallelExecution[] = [],
    initialView: AgentsWindowViewMode = "editor",
  ) {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw invalidState("sessionId inválido para janela de agentes.", ["sessionId"]);
    }
    if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
      throw invalidState("workspaceId inválido para janela de agentes.", ["workspaceId"]);
    }
    if (initialView !== "editor" && initialView !== "agents_window") {
      throw invalidState(`Modo de visão inicial '${initialView}' inválido.`, ["initialView"]);
    }

    for (const item of initialExecutions) {
      validateExecutionItem(item);
    }

    this.sessionIdValue = sessionId.trim();
    this.workspaceIdValue = workspaceId.trim();
    this.currentViewMode = initialView;
    this.executionsList = [...initialExecutions];
    this.view = this.renderSnapshot();
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get workspaceId(): string {
    return this.workspaceIdValue;
  }

  get currentView(): AgentsWindowViewMode {
    return this.currentViewMode;
  }

  get executions(): readonly AgentParallelExecution[] {
    return this.executionsList;
  }

  get snapshot(): AgentsWindowViewSnapshot {
    return this.view;
  }

  /**
   * Registra um listener para mudanças de estado (controlador observável).
   */
  subscribe(listener: AgentsWindowListener): () => void {
    if (typeof listener !== "function") {
      throw invalidState("Listener deve ser uma função.", ["listener"]);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.view);
      } catch {
        // Ignora erros em listeners externos
      }
    }
  }

  private renderSnapshot(): AgentsWindowViewSnapshot {
    return buildAgentsWindowView({
      sessionId: this.sessionIdValue,
      workspaceId: this.workspaceIdValue,
      currentView: this.currentViewMode,
      executions: this.executionsList,
      errorMessage: this.errorMessage,
    });
  }

  private assertWorkspaceScope(options: AgentsWindowNavigationOptions): void {
    if (
      options.targetWorkspaceId !== undefined &&
      options.allowedWorkspaceId !== undefined &&
      options.targetWorkspaceId !== options.allowedWorkspaceId
    ) {
      throw outOfScope("Workspace de destino difere do escopo autorizado.", [
        options.targetWorkspaceId,
        options.allowedWorkspaceId,
      ]);
    }
    if (
      options.targetWorkspaceId !== undefined &&
      options.targetWorkspaceId !== this.workspaceIdValue
    ) {
      throw outOfScope("Workspace de navegação difere do workspace atual da janela.", [
        options.targetWorkspaceId,
        this.workspaceIdValue,
      ]);
    }
  }

  /**
   * Abre a janela de agentes listando execuções paralelas locais (UI-04).
   */
  openAgentsWindow(options: AgentsWindowNavigationOptions = {}): AgentsWindowViewSnapshot {
    this.assertWorkspaceScope(options);
    this.currentViewMode = "agents_window";
    this.errorMessage = null;
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Volta ao editor no mesmo workspace (UI-04).
   */
  returnToEditor(options: AgentsWindowNavigationOptions = {}): AgentsWindowViewSnapshot {
    if (this.currentViewMode === "editor") {
      throw invalidState("Comando inválido: o produto já se encontra na visualização do editor.", [
        this.currentViewMode,
      ]);
    }
    this.assertWorkspaceScope(options);
    this.currentViewMode = "editor";
    this.errorMessage = null;
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Define a lista de execuções paralelas ativas/concluídas/com falha.
   */
  setExecutions(executions: readonly AgentParallelExecution[]): AgentsWindowViewSnapshot {
    if (!Array.isArray(executions)) {
      throw invalidState("Execuções devem ser fornecidas em um array.", ["executions"]);
    }
    for (const item of executions) {
      validateExecutionItem(item);
    }
    this.executionsList = [...executions];
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Insere ou atualiza uma execução paralela.
   */
  upsertExecution(execution: AgentParallelExecution): AgentsWindowViewSnapshot {
    validateExecutionItem(execution);
    const index = this.executionsList.findIndex((e) => e.agentId === execution.agentId);
    if (index >= 0) {
      this.executionsList[index] = execution;
    } else {
      this.executionsList.push(execution);
    }
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Atualiza status e sumário de um agente específico.
   */
  updateExecutionStatus(
    agentId: string,
    status: AgentExecutionStatus,
    summary?: string,
  ): AgentsWindowViewSnapshot {
    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      throw invalidState("agentId inválido para atualização de status.", ["agentId"]);
    }
    if (!VALID_STATUSES.includes(status)) {
      throw invalidState(
        `status '${status}' inválido. Valores aceitos: ${VALID_STATUSES.join(", ")}.`,
        ["status"],
      );
    }
    const target = this.executionsList.find((e) => e.agentId === agentId);
    if (!target) {
      throw invalidState(`Execução de agente com id '${agentId}' não encontrada.`, [agentId]);
    }

    target.status = status;
    if (summary !== undefined) {
      target.summary = summary;
    }
    if (status === "completed" || status === "failed") {
      target.completedAt = new Date().toISOString();
    }

    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Remove uma execução pelo seu identificador.
   */
  removeExecution(agentId: string): AgentsWindowViewSnapshot {
    if (typeof agentId !== "string" || agentId.trim().length === 0) {
      throw invalidState("agentId inválido para remoção.", ["agentId"]);
    }
    this.executionsList = this.executionsList.filter((e) => e.agentId !== agentId);
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Carrega execuções via porta externa (daemon ou storage local).
   */
  async listViaPort(port: AgentsWindowPort): Promise<AgentsWindowViewSnapshot> {
    if (!port || typeof port.listParallelExecutions !== "function") {
      throw invalidState("Porta de agentes paralelos inválida.", ["port"]);
    }
    try {
      const items = await port.listParallelExecutions({
        workspaceId: this.workspaceIdValue,
      });
      return this.setExecutions(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.errorMessage = message;
      this.view = this.renderSnapshot();
      this.notify();
      return this.view;
    }
  }

  /**
   * Define mensagem de erro visível na view.
   */
  setError(message: string | null): AgentsWindowViewSnapshot {
    this.errorMessage = message;
    this.view = this.renderSnapshot();
    this.notify();
    return this.view;
  }

  /**
   * Limpa a mensagem de erro.
   */
  clearError(): AgentsWindowViewSnapshot {
    return this.setError(null);
  }
}
