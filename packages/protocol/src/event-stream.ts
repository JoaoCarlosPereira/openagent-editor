import { incompleteStreamError, PROTOCOL_ERROR_CODES } from "./errors.js";
import {
  validateHarnessEvent,
  validateHarnessEventStream,
  type HarnessEvent,
} from "./harness-event.js";

/** Tamanho padrão do buffer in-memory antes de sinalizar backpressure ao produtor. */
export const DEFAULT_HARNESS_EVENT_STREAM_BUFFER_SIZE = 64;

export type HarnessEventStreamPushResult =
  | { accepted: true; event: HarnessEvent }
  | { accepted: false; code: "INVALID_STATE"; errors: string[] }
  | { accepted: false; code: "INCOMPLETE_STREAM"; backpressure: true };

export interface HarnessEventStreamOptions {
  runId: string;
  /** Eventos já persistidos (replay após restart). Devem estar em ordem crescente de sequence. */
  persistedEvents?: HarnessEvent[];
  /** Máximo de eventos aguardando consumo antes de backpressure. */
  maxBufferedEvents?: number;
}

export interface HarnessEventStreamSnapshot {
  runId: string;
  events: HarnessEvent[];
  nextSequence: number;
  closed: boolean;
}

/**
 * Controlador de stream ordenado com buffer limitado e backpressure.
 * Eventos entregues ao consumidor respeitam sequence estritamente crescente.
 */
export class HarnessEventStreamController {
  public readonly runId: string;
  private readonly maxBufferedEvents: number;
  private readonly delivered: HarnessEvent[] = [];
  private readonly pending: HarnessEvent[] = [];
  private nextSequence: number;
  private closed = false;
  private waiters: Array<() => void> = [];

  constructor(options: HarnessEventStreamOptions) {
    this.runId = options.runId;
    this.maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_HARNESS_EVENT_STREAM_BUFFER_SIZE;

    const persisted = options.persistedEvents ?? [];
    if (persisted.length > 0) {
      const validation = validateHarnessEventStream(persisted);
      if (!validation.valid || !validation.events) {
        throw incompleteStreamError();
      }
      for (const event of validation.events) {
        if (event.runId !== this.runId) {
          throw incompleteStreamError();
        }
      }
      this.delivered.push(...validation.events);
      const lastPersisted = validation.events.at(-1);
      if (!lastPersisted) {
        throw incompleteStreamError();
      }
      this.nextSequence = lastPersisted.sequence + 1;
    } else {
      this.nextSequence = 1;
    }
  }

  get bufferedCount(): number {
    return this.pending.length;
  }

  get isBackpressured(): boolean {
    return this.pending.length >= this.maxBufferedEvents;
  }

  push(raw: unknown): HarnessEventStreamPushResult {
    if (this.closed) {
      return {
        accepted: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: ["Stream de eventos já encerrado."],
      };
    }

    if (this.pending.length >= this.maxBufferedEvents) {
      return {
        accepted: false,
        code: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
        backpressure: true,
      };
    }

    const validated = validateHarnessEvent(raw);
    if (!validated.valid) {
      return {
        accepted: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: validated.errors,
      };
    }

    if (validated.value.runId !== this.runId) {
      return {
        accepted: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: ["runId do evento difere do stream."],
      };
    }

    if (validated.value.sequence !== this.nextSequence) {
      return {
        accepted: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: [
          `sequence ${validated.value.sequence} deve ser exatamente ${this.nextSequence}.`,
        ],
      };
    }

    this.nextSequence += 1;
    this.pending.push(validated.value);
    this.wakeWaiters();
    return { accepted: true, event: validated.value };
  }

  tryShift(): HarnessEvent | undefined {
    const event = this.pending.shift();
    if (event) {
      this.delivered.push(event);
      this.wakeWaiters();
    }
    return event;
  }

  async *consume(): AsyncGenerator<HarnessEvent, void, void> {
    while (!this.closed || this.pending.length > 0) {
      const event = this.tryShift();
      if (event) {
        yield event;
        continue;
      }
      if (this.closed) {
        return;
      }
      await this.waitForData();
    }
  }

  close(): void {
    this.closed = true;
    this.wakeWaiters();
  }

  /** Persistência lógica para retomada após restart do editor (SES-01). */
  snapshot(): HarnessEventStreamSnapshot {
    return {
      runId: this.runId,
      events: [...this.delivered, ...this.pending],
      nextSequence: this.nextSequence,
      closed: this.closed,
    };
  }

  assertComplete(): void {
    if (!this.closed || this.pending.length > 0) {
      throw incompleteStreamError();
    }
  }

  private waitForData(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private wakeWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}

export function restoreHarnessEventStreamFromSnapshot(
  snapshot: HarnessEventStreamSnapshot,
  maxBufferedEvents?: number,
): HarnessEventStreamController {
  const validation = validateHarnessEventStream(snapshot.events);
  if (!validation.valid) {
    throw incompleteStreamError();
  }
  const controller = new HarnessEventStreamController({
    runId: snapshot.runId,
    persistedEvents: validation.events,
    maxBufferedEvents,
  });
  if (snapshot.closed) {
    controller.close();
  }
  return controller;
}
