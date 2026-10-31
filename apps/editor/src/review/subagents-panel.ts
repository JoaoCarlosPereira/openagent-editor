import {
  HarnessEventStreamController,
  ProtocolError,
  RPC_METHOD,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  buildSubagentsPanelView,
  type SubagentRow,
  type SubagentUiState,
  type SubagentsPanelViewSnapshot,
} from "./subagents-panel-view.js";

export type {
  SubagentRow,
  SubagentUiState,
  SubagentsPanelViewSnapshot,
} from "./subagents-panel-view.js";
export { buildSubagentsPanelView } from "./subagents-panel-view.js";

/** Eventos Harness emitidos por agent.spawn / agent.cancel (AGT-05 / AGT-07). */
export const AGENT_SPAWNED_EVENT = "agent.spawned";
export const AGENT_COMPLETED_EVENT = "agent.completed";
export const AGENT_CANCELLED_EVENT = "agent.cancelled";

export interface AgentSpawnedPayload {
  agentId: string;
  name: string;
  objective?: string;
  runId?: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  name: string;
  resultRef: string;
  resultSummary?: string;
  runId?: string;
}

export interface AgentCancelledPayload {
  agentId: string;
  name: string;
  runId?: string;
}

export interface SubagentsPanelPushInput {
  event: unknown;
  payload: unknown;
}

export interface SubagentCancelResult {
  rpc: { method: typeof RPC_METHOD.AGENT_CANCEL; params: { agentId: string } };
  view: SubagentsPanelViewSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError("INVALID_STATE", `Campo '${field}' inválido no payload.`, [field]);
  }
  return value.trim();
}

function parseSpawnedPayload(raw: unknown, expectedRunId: string): AgentSpawnedPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload agent.spawned inválido.", ["payload"]);
  }
  if (typeof raw.runId === "string" && raw.runId.trim().length > 0) {
    const runId = raw.runId.trim();
    if (runId !== expectedRunId) {
      throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
        runId,
        expectedRunId,
      ]);
    }
  }
  return {
    agentId: requireNonEmptyString(raw.agentId, "agentId"),
    name: requireNonEmptyString(raw.name, "name"),
    ...(typeof raw.objective === "string" && raw.objective.trim().length > 0
      ? { objective: raw.objective.trim() }
      : {}),
  };
}

function parseCompletedPayload(raw: unknown, expectedRunId: string): AgentCompletedPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload agent.completed inválido.", ["payload"]);
  }
  if (typeof raw.runId === "string" && raw.runId.trim().length > 0) {
    const runId = raw.runId.trim();
    if (runId !== expectedRunId) {
      throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
        runId,
        expectedRunId,
      ]);
    }
  }
  return {
    agentId: requireNonEmptyString(raw.agentId, "agentId"),
    name: requireNonEmptyString(raw.name, "name"),
    resultRef: requireNonEmptyString(raw.resultRef, "resultRef"),
    ...(typeof raw.resultSummary === "string" && raw.resultSummary.trim().length > 0
      ? { resultSummary: raw.resultSummary.trim() }
      : {}),
  };
}

function parseCancelledPayload(raw: unknown, expectedRunId: string): AgentCancelledPayload {
  if (!isRecord(raw)) {
    throw new ProtocolError("INVALID_STATE", "Payload agent.cancelled inválido.", ["payload"]);
  }
  if (typeof raw.runId === "string" && raw.runId.trim().length > 0) {
    const runId = raw.runId.trim();
    if (runId !== expectedRunId) {
      throw new ProtocolError("INVALID_STATE", "runId do payload diverge do run monitorado.", [
        runId,
        expectedRunId,
      ]);
    }
  }
  return {
    agentId: requireNonEmptyString(raw.agentId, "agentId"),
    name: requireNonEmptyString(raw.name, "name"),
  };
}

function emptyView(): SubagentsPanelViewSnapshot {
  return buildSubagentsPanelView({ agents: [] });
}

/**
 * AGT-05 / AGT-07: lista cada subagente com nome, estado e resultado;
 * cancelamento isola um agentId e conserva o estado dos demais.
 */
export class SubagentsPanelController {
  private readonly stream: HarnessEventStreamController;
  private readonly agents = new Map<string, SubagentRow>();
  private view: SubagentsPanelViewSnapshot;

  constructor(runId: string) {
    this.stream = new HarnessEventStreamController({ runId });
    this.view = emptyView();
  }

  get runId(): string {
    return this.stream.runId;
  }

  get snapshot(): SubagentsPanelViewSnapshot {
    return this.view;
  }

  listAgents(): readonly SubagentRow[] {
    return [...this.agents.values()];
  }

  push(input: SubagentsPanelPushInput): SubagentsPanelViewSnapshot {
    const eventCheck = validateHarnessEvent(input.event);
    if (!eventCheck.valid) {
      throw new ProtocolError("INVALID_STATE", "HarnessEvent inválido.", eventCheck.errors);
    }
    const event = eventCheck.value;
    if (event.runId !== this.runId) {
      throw new ProtocolError("INVALID_STATE", "runId do evento diverge do run monitorado.", [
        event.runId,
        this.runId,
      ]);
    }

    if (event.type === AGENT_SPAWNED_EVENT) {
      const payload = parseSpawnedPayload(input.payload, this.runId);
      if (this.agents.has(payload.agentId)) {
        throw new ProtocolError(
          "INVALID_STATE",
          "Subagente já registrado neste painel.",
          [payload.agentId],
        );
      }
      this.acceptStreamEvent(event, AGENT_SPAWNED_EVENT);
      this.agents.set(payload.agentId, {
        agentId: payload.agentId,
        name: payload.name,
        state: "running",
        resultRef: null,
        resultSummary: null,
      });
    } else if (event.type === AGENT_COMPLETED_EVENT) {
      const payload = parseCompletedPayload(input.payload, this.runId);
      const existing = this.agents.get(payload.agentId);
      if (!existing) {
        throw new ProtocolError(
          "INVALID_STATE",
          "agent.completed exige subagente previamente spawnado.",
          [payload.agentId],
        );
      }
      if (existing.state !== "running") {
        throw new ProtocolError(
          "INVALID_STATE",
          "Só subagente em execução pode concluir.",
          [payload.agentId, existing.state],
        );
      }
      this.acceptStreamEvent(event, AGENT_COMPLETED_EVENT);
      this.agents.set(payload.agentId, {
        agentId: payload.agentId,
        name: payload.name,
        state: "complete",
        resultRef: payload.resultRef,
        resultSummary: payload.resultSummary ?? `Subagente "${payload.name}" concluiu.`,
      });
    } else if (event.type === AGENT_CANCELLED_EVENT) {
      const payload = parseCancelledPayload(input.payload, this.runId);
      const existing = this.agents.get(payload.agentId);
      if (!existing) {
        throw new ProtocolError(
          "INVALID_STATE",
          "agent.cancelled exige subagente previamente spawnado.",
          [payload.agentId],
        );
      }
      if (existing.state === "complete") {
        throw new ProtocolError(
          "INVALID_STATE",
          "Subagente já concluído; cancelamento não aplicável.",
          [payload.agentId],
        );
      }
      if (existing.state !== "running" && existing.state !== "cancelled") {
        throw new ProtocolError(
          "INVALID_STATE",
          `Estado de subagente inválido para cancelamento: ${existing.state}`,
          [payload.agentId],
        );
      }
      // Idempotente: eco após cancel UI (ou duplicata) ainda avança a sequence do stream.
      this.acceptStreamEvent(event, AGENT_CANCELLED_EVENT);
      if (existing.state === "running") {
        this.markCancelled(payload.agentId, payload.name);
      }
    } else {
      throw new ProtocolError(
        "INVALID_STATE",
        "Tipo de evento não suportado no painel de subagentes.",
        [event.type],
      );
    }

    this.view = this.buildCurrentView();
    return this.view;
  }

  /**
   * Ação de UI: valida e devolve RPC agent.cancel só para o agentId indicado (AGT-07).
   * Não muta o mapa de forma otimista — o estado `cancelled` vem do eco
   * `agent.cancelled` via `push`/`acceptStreamEvent`, alinhado à sequence do daemon.
   * Os demais agents permanecem intactos.
   */
  cancelSubagent(agentIdRaw: unknown): SubagentCancelResult {
    if (typeof agentIdRaw !== "string" || agentIdRaw.trim().length === 0) {
      throw new ProtocolError("INVALID_STATE", "agentId inválido para cancelamento.", ["agentId"]);
    }
    const agentId = agentIdRaw.trim();
    this.assertCancellable(agentId);
    return {
      rpc: {
        method: RPC_METHOD.AGENT_CANCEL,
        params: { agentId },
      },
      view: this.view,
    };
  }

  private assertCancellable(agentId: string): SubagentRow {
    const existing = this.agents.get(agentId);
    if (!existing) {
      throw new ProtocolError("INVALID_STATE", "agentId inexistente para cancelamento.", [agentId]);
    }
    if (existing.state === "complete") {
      throw new ProtocolError(
        "INVALID_STATE",
        "Subagente já concluído; cancelamento não aplicável.",
        [agentId],
      );
    }
    if (existing.state === "cancelled") {
      throw new ProtocolError("INVALID_STATE", "Subagente já cancelado.", [agentId]);
    }
    if (existing.state !== "running") {
      throw new ProtocolError(
        "INVALID_STATE",
        `Estado de subagente inválido para cancelamento: ${existing.state}`,
        [agentId],
      );
    }
    return existing;
  }

  private markCancelled(agentId: string, name: string): void {
    const existing = this.agents.get(agentId);
    if (!existing) {
      throw new ProtocolError("INVALID_STATE", "agentId inexistente para cancelamento.", [agentId]);
    }
    this.agents.set(agentId, {
      agentId,
      name: name.trim().length > 0 ? name.trim() : existing.name,
      state: "cancelled" satisfies SubagentUiState,
      resultRef: null,
      resultSummary: null,
    });
  }

  private acceptStreamEvent(event: HarnessEvent, label: string): void {
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(pushResult.code, `Evento ${label} rejeitado pelo stream.`, [
        ...(pushResult.code === "INVALID_STATE" ? pushResult.errors : []),
      ]);
    }
  }

  private buildCurrentView(): SubagentsPanelViewSnapshot {
    return buildSubagentsPanelView({ agents: [...this.agents.values()] });
  }
}
