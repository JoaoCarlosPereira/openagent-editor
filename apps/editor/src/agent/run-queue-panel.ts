import {
  ProtocolError,
  RPC_METHOD,
  validateUserInput,
  type UserInput,
} from "@openagent/protocol";

import {
  buildRunQueuePanelView,
  previewTextFromUserInput,
  type RunQueueItemRow,
  type RunQueuePanelViewSnapshot,
} from "./run-queue-panel-view.js";

export type {
  RunQueueItemRow,
  RunQueueItemUiState,
  RunQueuePanelViewSnapshot,
} from "./run-queue-panel-view.js";
export {
  buildRunQueuePanelView,
  previewTextFromUserInput,
} from "./run-queue-panel-view.js";

export type RunQueueLifecycle = "idle" | "running";

export interface RunQueueEnqueueRequestResult {
  rpc: {
    method: typeof RPC_METHOD.RUN_QUEUE_ADD;
    params: { input: UserInput };
  };
  view: RunQueuePanelViewSnapshot;
}

export interface RunQueueRemoveRequestResult {
  rpc: {
    method: typeof RPC_METHOD.RUN_QUEUE_REMOVE;
    params: { queueItemId: string };
  };
  view: RunQueuePanelViewSnapshot;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError("INVALID_STATE", message, [...details]);
}

function emptyView(runId: string, lifecycle: RunQueueLifecycle): RunQueuePanelViewSnapshot {
  return buildRunQueuePanelView({ runId, runLifecycle: lifecycle, items: [] });
}

/**
 * AGT-06: fila visível durante a execução; mensagem enfileirada via
 * `run.queue.add`; remoção só de itens pending via `run.queue.remove`.
 */
export class RunQueuePanelController {
  private readonly items = new Map<string, RunQueueItemRow>();
  private lifecycle: RunQueueLifecycle = "idle";
  private view: RunQueuePanelViewSnapshot;

  constructor(private readonly runIdValue: string) {
    if (typeof runIdValue !== "string" || runIdValue.trim().length === 0) {
      throw invalidState("runId inválido para o painel de fila.", ["runId"]);
    }
    this.view = emptyView(this.runIdValue, this.lifecycle);
  }

  get runId(): string {
    return this.runIdValue;
  }

  get snapshot(): RunQueuePanelViewSnapshot {
    return this.view;
  }

  listItems(): readonly RunQueueItemRow[] {
    return this.orderedItems();
  }

  /** Marca o run como em execução — pré-condição para enfileirar/remover. */
  beginRunning(): RunQueuePanelViewSnapshot {
    this.lifecycle = "running";
    this.refreshView();
    return this.view;
  }

  /** Encerra o ciclo; novas mutações de fila passam a INVALID_STATE. */
  endRunning(): RunQueuePanelViewSnapshot {
    this.lifecycle = "idle";
    this.refreshView();
    return this.view;
  }

  /**
   * Pedido de UI: valida entrada e devolve RPC `run.queue.add` sem mutar a
   * fila local (eco via `acceptEnqueue` após o daemon).
   */
  requestEnqueue(rawInput: unknown): RunQueueEnqueueRequestResult {
    this.assertRunning("enfileirar");
    const validation = validateUserInput(rawInput);
    if (!validation.valid) {
      throw invalidState(
        validation.userMessage ?? `UserInput inválido: ${validation.errors.join("; ")}`,
        validation.errors,
      );
    }
    return {
      rpc: {
        method: RPC_METHOD.RUN_QUEUE_ADD,
        params: { input: validation.value },
      },
      view: this.view,
    };
  }

  /**
   * Confirma o resultado de `run.queue.add` e torna o item visível como pending.
   */
  acceptEnqueue(
    result: { queueItemId: unknown; ordinal: unknown },
    rawInput: unknown,
  ): RunQueuePanelViewSnapshot {
    this.assertRunning("aceitar item na fila");
    const queueItemId = this.requireNonEmptyString(result.queueItemId, "queueItemId");
    const ordinal = this.requirePositiveOrdinal(result.ordinal);
    const validation = validateUserInput(rawInput);
    if (!validation.valid) {
      throw invalidState(
        validation.userMessage ?? `UserInput inválido: ${validation.errors.join("; ")}`,
        validation.errors,
      );
    }
    if (this.items.has(queueItemId)) {
      throw invalidState("Item de fila já registrado neste painel.", [queueItemId]);
    }
    const before = this.snapshotItems();
    try {
      this.items.set(queueItemId, {
        queueItemId,
        ordinal,
        state: "pending",
        previewText: previewTextFromUserInput(validation.value),
        input: validation.value,
      });
      this.refreshView();
      return this.view;
    } catch (error) {
      this.restoreItems(before);
      this.refreshView();
      throw error;
    }
  }

  /**
   * Pedido de UI: só itens pending; devolve RPC `run.queue.remove` sem mutar
   * até `acceptRemove`.
   */
  requestRemove(queueItemIdRaw: unknown): RunQueueRemoveRequestResult {
    this.assertRunning("remover da fila");
    const queueItemId = this.requireNonEmptyString(queueItemIdRaw, "queueItemId");
    this.assertRemovable(queueItemId);
    return {
      rpc: {
        method: RPC_METHOD.RUN_QUEUE_REMOVE,
        params: { queueItemId },
      },
      view: this.view,
    };
  }

  /** Confirma remoção após RPC bem-sucedido. */
  acceptRemove(queueItemIdRaw: unknown): RunQueuePanelViewSnapshot {
    this.assertRunning("confirmar remoção");
    const queueItemId = this.requireNonEmptyString(queueItemIdRaw, "queueItemId");
    this.assertRemovable(queueItemId);
    const before = this.snapshotItems();
    try {
      this.items.delete(queueItemId);
      this.refreshView();
      return this.view;
    } catch (error) {
      this.restoreItems(before);
      this.refreshView();
      throw error;
    }
  }

  /** Daemon consumiu o próximo item: deixa de ser removível. */
  markStarted(queueItemIdRaw: unknown): RunQueuePanelViewSnapshot {
    this.assertRunning("marcar iniciado");
    const queueItemId = this.requireNonEmptyString(queueItemIdRaw, "queueItemId");
    const existing = this.items.get(queueItemId);
    if (!existing) {
      throw invalidState("Item de fila inexistente.", [queueItemId]);
    }
    if (existing.state === "started") {
      throw invalidState("Item de fila já foi iniciado.", [queueItemId]);
    }
    const before = this.snapshotItems();
    try {
      this.items.set(queueItemId, { ...existing, state: "started" });
      this.refreshView();
      return this.view;
    } catch (error) {
      this.restoreItems(before);
      this.refreshView();
      throw error;
    }
  }

  private assertRunning(action: string): void {
    if (this.lifecycle !== "running") {
      throw invalidState(
        `Fila editável somente enquanto a execução está em andamento (${action}).`,
        [this.lifecycle],
      );
    }
  }

  private assertRemovable(queueItemId: string): RunQueueItemRow {
    const existing = this.items.get(queueItemId);
    if (!existing) {
      throw invalidState("Item de fila inexistente.", [queueItemId]);
    }
    if (existing.state === "started") {
      throw invalidState("Não é possível remover item de fila já iniciado.", [
        queueItemId,
      ]);
    }
    if (existing.state !== "pending") {
      throw invalidState(`Estado de item inválido para remoção: ${existing.state}`, [
        queueItemId,
      ]);
    }
    return existing;
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalidState(`Campo '${field}' inválido.`, [field]);
    }
    return value.trim();
  }

  private requirePositiveOrdinal(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      throw invalidState("Campo 'ordinal' inválido.", ["ordinal"]);
    }
    return value;
  }

  private orderedItems(): RunQueueItemRow[] {
    return [...this.items.values()].sort((a, b) => a.ordinal - b.ordinal);
  }

  private snapshotItems(): Map<string, RunQueueItemRow> {
    return new Map(
      [...this.items.entries()].map(([id, item]) => [
        id,
        { ...item, input: { ...item.input } },
      ]),
    );
  }

  private restoreItems(snapshot: Map<string, RunQueueItemRow>): void {
    this.items.clear();
    for (const [id, item] of snapshot) {
      this.items.set(id, item);
    }
  }

  private refreshView(): void {
    this.view = buildRunQueuePanelView({
      runId: this.runIdValue,
      runLifecycle: this.lifecycle,
      items: this.orderedItems(),
    });
  }
}
