import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateUserInput,
  type UserInput,
} from "@openagent/protocol";
import type { RunLifecycleState } from "../state/run-state.js";

export type RunQueueItemState = "pending" | "started";

export type RunQueueItem = {
  queueItemId: string;
  runId: string;
  ordinal: number;
  input: UserInput;
  state: RunQueueItemState;
};

function invalidQueueState(message: string): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

function assertRunAcceptsQueueMutations(lifecycleState: RunLifecycleState): void {
  if (lifecycleState !== "running") {
    throw invalidQueueState(
      "Fila editável somente enquanto a execução está em andamento.",
    );
  }
}

/**
 * Fila ordenada de mensagens do usuário durante uma execução (AGT-06).
 * Remoção permitida apenas para itens ainda não iniciados.
 */
export class RunMessageQueue {
  private readonly items: RunQueueItem[] = [];
  private nextOrdinal = 1;

  snapshot(): readonly RunQueueItem[] {
    return this.items.map((item) => ({ ...item, input: { ...item.input } }));
  }

  enqueue(options: {
    runLifecycleState: RunLifecycleState;
    runId: string;
    input: unknown;
  }): RunQueueItem {
    assertRunAcceptsQueueMutations(options.runLifecycleState);

    const inputResult = validateUserInput(options.input);
    if (!inputResult.valid) {
      throw invalidQueueState(inputResult.errors.join(" "));
    }

    const item: RunQueueItem = {
      queueItemId: crypto.randomUUID(),
      runId: options.runId,
      ordinal: this.nextOrdinal++,
      input: inputResult.value,
      state: "pending",
    };
    this.items.push(item);
    return { ...item, input: { ...item.input } };
  }

  removePending(queueItemId: string, runLifecycleState: RunLifecycleState): RunQueueItem {
    assertRunAcceptsQueueMutations(runLifecycleState);

    const index = this.items.findIndex((item) => item.queueItemId === queueItemId);
    if (index === -1) {
      throw invalidQueueState("Item de fila inexistente.");
    }

    const item = this.items[index]!;
    if (item.state === "started") {
      throw invalidQueueState("Não é possível remover item de fila já iniciado.");
    }

    this.items.splice(index, 1);
    return { ...item, input: { ...item.input } };
  }

  /** Marca o próximo item pendente como iniciado (consumo interno). */
  markStarted(queueItemId: string): void {
    const item = this.items.find((entry) => entry.queueItemId === queueItemId);
    if (!item) {
      throw invalidQueueState("Item de fila inexistente.");
    }
    if (item.state === "started") {
      throw invalidQueueState("Item de fila já foi iniciado.");
    }
    item.state = "started";
  }

  pendingInOrder(): readonly RunQueueItem[] {
    return this.items
      .filter((item) => item.state === "pending")
      .map((item) => ({ ...item, input: { ...item.input } }));
  }
}
