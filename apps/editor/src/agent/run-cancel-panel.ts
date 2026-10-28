import {
  HarnessEventStreamController,
  ProtocolError,
  RPC_METHOD,
  refuseToolInTerminalRunError,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  buildRunCancelPanelView,
  type AppliedChangeRow,
  type RunCancelPanelViewSnapshot,
  type RunCancelUiState,
} from "./run-cancel-panel-view.js";

export type {
  AppliedChangeRow,
  RunCancelPanelViewSnapshot,
  RunCancelUiState,
} from "./run-cancel-panel-view.js";
export {
  buildRunCancelPanelView,
  runCancelStatusLabel,
} from "./run-cancel-panel-view.js";

/** Evento Harness emitido por `run.cancel` (PER-02 / task_47). */
export const RUN_CANCELLED_EVENT = "run.cancelled";

/** Limite observável PER-02: Cancelada em até 2 s. */
export const RUN_CANCEL_DEADLINE_MS = 2000;

export interface RunCancelledPayload {
  runId?: string;
  endedAt?: string;
}

export interface RunCancelPanelPushInput {
  event: unknown;
  payload?: unknown;
}

export interface RunCancelRequestResult {
  rpc: {
    method: typeof RPC_METHOD.RUN_CANCEL;
    params: Record<string, never>;
  };
  view: RunCancelPanelViewSnapshot;
  /** Relógio local no momento do pedido (para asserção ≤ 2 s). */
  cancelRequestedAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError("INVALID_STATE", message, [...details]);
}

function emptyView(runId: string): RunCancelPanelViewSnapshot {
  return buildRunCancelPanelView({
    runId,
    runState: "idle",
    appliedChanges: [],
    cancelLatencyMs: null,
  });
}

/**
 * PER-02: cancelar run na UI — RPC `run.cancel` sem mutação otimista;
 * estado `Cancelada` só após eco `run.cancelled` via stream (≤ 2 s).
 * Alterações já aplicadas permanecem; nova ferramenta é recusada.
 */
export class RunCancelPanelController {
  private readonly stream: HarnessEventStreamController;
  private runState: RunCancelUiState = "idle";
  private readonly appliedChanges: AppliedChangeRow[] = [];
  private cancelRequestedAtMs: number | null = null;
  private cancelLatencyMs: number | null = null;
  private view: RunCancelPanelViewSnapshot;
  private readonly now: () => number;

  constructor(
    runId: string,
    options: { now?: () => number } = {},
  ) {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      throw invalidState("runId inválido para o painel de cancelamento.", ["runId"]);
    }
    this.stream = new HarnessEventStreamController({ runId: runId.trim() });
    this.now = options.now ?? (() => Date.now());
    this.view = emptyView(this.stream.runId);
  }

  get runId(): string {
    return this.stream.runId;
  }

  get snapshot(): RunCancelPanelViewSnapshot {
    return this.view;
  }

  listAppliedChanges(): readonly AppliedChangeRow[] {
    return [...this.appliedChanges];
  }

  /** Pré-condição: execução em andamento. */
  beginRunning(): RunCancelPanelViewSnapshot {
    if (this.runState === "cancelled") {
      throw invalidState("Execução já cancelada; não é possível reiniciar neste painel.", [
        this.runId,
      ]);
    }
    this.runState = "running";
    this.cancelRequestedAtMs = null;
    this.cancelLatencyMs = null;
    this.refreshView();
    return this.view;
  }

  /**
   * Registra alteração já aplicada antes do cancelamento (conservada após Cancelada).
   */
  recordAppliedChange(raw: unknown): RunCancelPanelViewSnapshot {
    if (this.runState !== "running" && this.runState !== "cancelled") {
      throw invalidState(
        "Alterações só são registradas durante ou após uma execução.",
        [this.runState],
      );
    }
    if (!isRecord(raw)) {
      throw invalidState("Alteração aplicada inválida.", ["appliedChange"]);
    }
    const changeId = this.requireNonEmptyString(raw.changeId, "changeId");
    const path = this.requireNonEmptyString(raw.path, "path");
    const summary = this.requireNonEmptyString(raw.summary, "summary");
    if (this.appliedChanges.some((c) => c.changeId === changeId)) {
      throw invalidState("Alteração já registrada neste painel.", [changeId]);
    }
    this.appliedChanges.push({ changeId, path, summary });
    this.refreshView();
    return this.view;
  }

  /**
   * Pedido de UI: devolve RPC `run.cancel` sem mutar o estado (eco via `push`).
   */
  requestCancel(): RunCancelRequestResult {
    if (this.runState !== "running") {
      throw invalidState(
        "Cancelamento só é permitido enquanto a execução está em andamento.",
        [this.runState],
      );
    }
    if (this.cancelRequestedAtMs !== null) {
      throw invalidState("Cancelamento já solicitado para esta execução.", [this.runId]);
    }
    this.cancelRequestedAtMs = this.now();
    return {
      rpc: {
        method: RPC_METHOD.RUN_CANCEL,
        params: {},
      },
      view: this.view,
      cancelRequestedAtMs: this.cancelRequestedAtMs,
    };
  }

  /**
   * Consome eco `run.cancelled` do daemon. Atualiza para Cancelada e mede latência.
   * Idempotente para eco duplicado ainda alinhado à sequence.
   */
  push(input: RunCancelPanelPushInput): RunCancelPanelViewSnapshot {
    const eventCheck = validateHarnessEvent(input.event);
    if (!eventCheck.valid) {
      throw invalidState("HarnessEvent inválido.", eventCheck.errors);
    }
    const event = eventCheck.value;
    if (event.runId !== this.runId) {
      throw invalidState("runId do evento diverge do run monitorado.", [
        event.runId,
        this.runId,
      ]);
    }
    if (event.type !== RUN_CANCELLED_EVENT) {
      throw invalidState("Tipo de evento não suportado no painel de cancelamento.", [
        event.type,
      ]);
    }
    this.parseCancelledPayload(input.payload);

    if (this.runState === "idle") {
      throw invalidState("run.cancelled exige execução previamente iniciada.", [this.runId]);
    }

    this.acceptStreamEvent(event, RUN_CANCELLED_EVENT);

    if (this.runState === "running") {
      const observedAt = this.now();
      const requestedAt = this.cancelRequestedAtMs ?? observedAt;
      const latencyMs = Math.max(0, observedAt - requestedAt);
      if (latencyMs > RUN_CANCEL_DEADLINE_MS) {
        throw invalidState(
          `Estado Cancelada excedeu o prazo PER-02 de ${RUN_CANCEL_DEADLINE_MS} ms.`,
          [`latencyMs=${latencyMs}`],
        );
      }
      this.cancelLatencyMs = latencyMs;
      this.runState = "cancelled";
    }

    this.refreshView();
    return this.view;
  }

  /**
   * Tentativa de iniciar ferramenta nesta execução. Após Cancelada → INVALID_STATE
   * (STA-01 / PER-02), sem alterar alterações já aplicadas.
   */
  beginToolInvocation(toolIdRaw: unknown): { accepted: true; toolId: string } {
    const toolId =
      typeof toolIdRaw === "string" && toolIdRaw.trim().length > 0
        ? toolIdRaw.trim()
        : null;
    if (toolId === null) {
      throw invalidState("toolId inválido para início de ferramenta.", ["toolId"]);
    }
    if (this.runState === "cancelled") {
      throw refuseToolInTerminalRunError("cancelled");
    }
    if (this.runState !== "running") {
      throw invalidState(
        "Ferramenta só inicia enquanto a execução está em andamento.",
        [this.runState, toolId],
      );
    }
    return { accepted: true, toolId };
  }

  private parseCancelledPayload(raw: unknown): RunCancelledPayload {
    if (raw === undefined || raw === null) {
      return {};
    }
    if (!isRecord(raw)) {
      throw invalidState("Payload run.cancelled inválido.", ["payload"]);
    }
    if (typeof raw.runId === "string" && raw.runId.trim().length > 0) {
      const runId = raw.runId.trim();
      if (runId !== this.runId) {
        throw invalidState("runId do payload diverge do run monitorado.", [
          runId,
          this.runId,
        ]);
      }
    }
    return {
      ...(typeof raw.runId === "string" ? { runId: raw.runId.trim() } : {}),
      ...(typeof raw.endedAt === "string" ? { endedAt: raw.endedAt } : {}),
    };
  }

  private acceptStreamEvent(event: HarnessEvent, label: string): void {
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(pushResult.code, `Evento ${label} rejeitado pelo stream.`, [
        ...(pushResult.code === "INVALID_STATE" ? pushResult.errors : []),
      ]);
    }
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidState(`Campo '${field}' inválido.`, [field]);
    }
    return value.trim();
  }

  private refreshView(): void {
    this.view = buildRunCancelPanelView({
      runId: this.runId,
      runState: this.runState,
      appliedChanges: this.appliedChanges,
      cancelLatencyMs: this.cancelLatencyMs,
    });
  }
}
