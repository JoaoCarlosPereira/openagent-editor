import {
  cancelledError,
  isProtocolError,
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  refuseToolInTerminalRunError,
} from "@openagent/protocol";

import type {
  AppliedToolRecord,
  InferToolInput,
  InferToolOutput,
  ToolExecutionPhase,
  ToolHandlerMap,
} from "./types.js";
import { TypedToolDispatchRegistry } from "./dispatch-registry.js";

const PER02_CANCEL_DEADLINE_MS = 2_000;

export interface ToolRunCoordinatorOptions {
  cancelDeadlineMs?: number;
  now?: () => number;
}

export interface ToolRunSnapshot {
  phase: ToolExecutionPhase;
  applied: readonly AppliedToolRecord[];
  cancelledAt: number | null;
}

/**
 * Orquestra despachos tipados durante uma execução de run (PER-02 / STA-01).
 */
export class ToolRunCoordinator<TTools extends ToolHandlerMap> {
  private phase: ToolExecutionPhase = "running";
  private cancelledAt: number | null = null;
  private readonly applied: AppliedToolRecord[] = [];
  private readonly abortController = new AbortController();
  private inFlight = 0;

  constructor(
    private readonly registry: TypedToolDispatchRegistry<TTools>,
    private readonly options: ToolRunCoordinatorOptions = {},
  ) {}

  snapshot(): ToolRunSnapshot {
    return {
      phase: this.phase,
      applied: [...this.applied],
      cancelledAt: this.cancelledAt,
    };
  }

  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Marca a execução como cancelada e interrompe trabalho em andamento.
   * Retorna quando não há mais dispatch in-flight ou estoura o prazo PER-02.
   */
  async cancel(): Promise<ToolRunSnapshot> {
    const now = this.options.now ?? Date.now;
    if (this.phase === "cancelled") {
      return this.snapshot();
    }
    this.phase = "cancelled";
    this.cancelledAt = now();
    this.abortController.abort();

    const deadlineMs = this.options.cancelDeadlineMs ?? PER02_CANCEL_DEADLINE_MS;
    const deadline = now() + deadlineMs;
    while (this.inFlight > 0 && now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    return this.snapshot();
  }

  async dispatch<K extends keyof TTools & string>(
    tool: K,
    input: InferToolInput<TTools, K>,
    invocationId: string,
  ): Promise<InferToolOutput<TTools, K>> {
    if (this.phase === "cancelled") {
      throw refuseToolInTerminalRunError("cancelled");
    }
    if (this.abortSignal.aborted) {
      throw cancelledError();
    }

    this.inFlight += 1;
    try {
      const output = await this.registry.invoke(tool, input);
      if (this.phase !== "running") {
        throw cancelledError();
      }
      this.applied.push({
        tool,
        invocationId,
        output,
        appliedAt: (this.options.now ?? Date.now)(),
      });
      return output;
    } catch (error) {
      if (this.abortSignal.aborted || this.phase !== "running") {
        throw cancelledError();
      }
      throw error;
    } finally {
      this.inFlight -= 1;
    }
  }

  assertMayDispatch(): void {
    if (this.phase === "cancelled") {
      throw refuseToolInTerminalRunError("cancelled");
    }
  }
}

export function invalidToolInputError(message: string): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

export function rethrowIfProtocolError(error: unknown): never {
  if (isProtocolError(error)) {
    throw error;
  }
  throw error;
}
