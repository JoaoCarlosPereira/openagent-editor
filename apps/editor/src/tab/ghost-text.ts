import { randomUUID } from "node:crypto";

import {
  COMPLETION_EVENT_TYPE,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  isProtocolError,
  type CancelCompletion,
  type CompletionCancelParams,
  type CompletionCancelResult,
  type CompletionEventPayload,
  type CompletionKind,
  type CompletionStartParams,
  type CompletionStartResult,
  type CompletionStreamEvent,
  type HarnessClient,
} from "@openagent/protocol";

import {
  buildGhostTextView,
  type GhostTextPhase,
  type GhostTextViewSnapshot,
} from "./ghost-text-view.js";

export type {
  GhostTextPhase,
  GhostTextViewSnapshot,
} from "./ghost-text-view.js";
export { buildGhostTextView, ghostTextStatusLabel } from "./ghost-text-view.js";

/** Limites de contexto herdados do comportamento de extension/inline.js. */
export const GHOST_TEXT_PREFIX_LIMIT = 1600;
export const GHOST_TEXT_SUFFIX_LIMIT = 800;

export type GhostTextStream = AsyncIterable<Pick<CompletionStreamEvent, "payload">> & {
  readonly result: Promise<CompletionStartResult>;
};

/** Porta que espelha completion.start / completion.cancel do protocolo. */
export interface GhostTextCompletionPort {
  start(params: CompletionStartParams): GhostTextStream;
  cancel(params: CompletionCancelParams): Promise<CompletionCancelResult>;
}

export type GhostTextRpcCall =
  | { method: typeof RPC_METHOD.COMPLETION_START; params: CompletionStartParams }
  | { method: typeof RPC_METHOD.COMPLETION_CANCEL; params: CompletionCancelParams };

export interface GhostTextControllerOptions {
  port: GhostTextCompletionPort;
  initialText?: string;
  language?: string;
  kind?: CompletionKind;
  newCompletionId?: () => string;
  /** TAB-01: false desliga a sugestão automática do workspace; adição e recusa seguem possíveis via API. */
  autoSuggestionsDisabled?: boolean;
}

/** Liga a porta ao cliente do daemon, vinculando sessao e run. */
export function createHarnessGhostTextPort(
  client: Pick<HarnessClient, "startCompletion" | "cancelCompletion">,
  binding: Pick<CancelCompletion, "sessionId" | "runId">,
): GhostTextCompletionPort {
  return {
    start: (params) => client.startCompletion({ ...binding, ...params }),
    cancel: (params) => client.cancelCompletion({ ...binding, ...params }),
  };
}

interface ActiveRequest {
  completionId: string;
  streamDone: boolean;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function errorCodeOf(error: unknown): string {
  return isProtocolError(error) ? error.code : PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM;
}

/**
 * TAB-01: ghost text com aceitar, recusar e cancelar.
 * idle -> requesting -> suggesting -> accepted | rejected | cancelled.
 * Nova digitacao cancela a sugestao anterior; deltas de pedidos encerrados sao ignorados.
 */
export class GhostTextController {
  private readonly port: GhostTextCompletionPort;
  private readonly language: string | undefined;
  private readonly kind: CompletionKind;
  private readonly autoSuggestionsDisabled: boolean;
  private readonly newCompletionId: () => string;
  private bufferText: string;
  private cursor: number;
  private phase: GhostTextPhase = "idle";
  private suggestion = "";
  private errorCode: string | null = null;
  private active: ActiveRequest | null = null;
  private lastCompletionId: string | null = null;
  private actionInFlight = false;
  private readonly rpcCalls: GhostTextRpcCall[] = [];
  private readonly tasks = new Set<Promise<void>>();
  private view: GhostTextViewSnapshot;

  constructor(options: GhostTextControllerOptions) {
    this.port = options.port;
    this.language = options.language;
    this.kind = options.kind ?? "line";
    this.autoSuggestionsDisabled = options.autoSuggestionsDisabled === true;
    this.newCompletionId = options.newCompletionId ?? (() => `ghost-${randomUUID()}`);
    this.bufferText = options.initialText ?? "";
    this.cursor = this.bufferText.length;
    this.view = this.buildView();
  }

  get snapshot(): GhostTextViewSnapshot {
    return this.view;
  }

  get text(): string {
    return this.bufferText;
  }

  get rpcLog(): readonly GhostTextRpcCall[] {
    return [...this.rpcCalls];
  }

  /** Aguarda o fim do consumo do stream e dos cancelamentos pendentes. */
  async settled(): Promise<GhostTextViewSnapshot> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
    return this.view;
  }

  /** Digitacao no cursor: cancela a sugestao anterior e pede uma nova. */
  type(raw: unknown): GhostTextViewSnapshot {
    if (typeof raw !== "string" || raw.length === 0) {
      throw invalidState("Texto digitado invalido.", ["text"]);
    }
    this.supersedeActive();
    this.bufferText =
      this.bufferText.slice(0, this.cursor) + raw + this.bufferText.slice(this.cursor);
    this.cursor += raw.length;
    this.suggestion = "";
    this.errorCode = null;

    const prefix = this.bufferText.slice(
      Math.max(0, this.cursor - GHOST_TEXT_PREFIX_LIMIT),
      this.cursor,
    );
    if (prefix.trim().length === 0) {
      this.phase = "idle";
      this.refreshView();
      return this.view;
    }
    // Sugestão automática desligada no workspace: nenhum completion.start;
    // sugestões pendentes são canceladas e o editor permanece em idle.
    if (this.autoSuggestionsDisabled) {
      this.phase = "idle";
      this.refreshView();
      return this.view;
    }
    const suffix = this.bufferText.slice(this.cursor, this.cursor + GHOST_TEXT_SUFFIX_LIMIT);
    this.startRequest({
      completionId: this.newCompletionId(),
      prefix,
      ...(suffix.length > 0 ? { suffix } : {}),
      ...(this.language !== undefined ? { language: this.language } : {}),
      kind: this.kind,
    });
    return this.view;
  }

  /** Insere a sugestao no buffer; geracao residual e cancelada. */
  accept(): Promise<GhostTextViewSnapshot> {
    return this.runAction(async () => {
      this.requireSuggestion("Aceitar");
      this.bufferText =
        this.bufferText.slice(0, this.cursor) + this.suggestion + this.bufferText.slice(this.cursor);
      this.cursor += this.suggestion.length;
      await this.finish("accepted", false);
    });
  }

  /** Descarta a sugestao sem alterar o buffer. */
  reject(): Promise<GhostTextViewSnapshot> {
    return this.runAction(async () => {
      this.requireSuggestion("Recusar");
      await this.finish("rejected", false);
    });
  }

  /** Aborta a geracao em andamento via completion.cancel. */
  cancel(): Promise<GhostTextViewSnapshot> {
    return this.runAction(async () => {
      if (this.phase !== "requesting" && this.phase !== "suggesting") {
        throw invalidState("Cancelar exige uma sugestao em andamento.", [this.phase]);
      }
      await this.finish("cancelled", true);
    });
  }

  private requireSuggestion(action: string): void {
    if (this.phase !== "suggesting" || this.suggestion.length === 0) {
      throw invalidState(`${action} exige uma sugestao disponivel.`, [this.phase]);
    }
  }

  private async runAction(
    action: () => Promise<void>,
  ): Promise<GhostTextViewSnapshot> {
    if (this.actionInFlight) {
      throw invalidState("Outra acao sobre a sugestao esta em andamento.", [this.phase]);
    }
    this.actionInFlight = true;
    try {
      await action();
      return this.view;
    } finally {
      this.actionInFlight = false;
    }
  }

  private async finish(phase: GhostTextPhase, propagateCancelError: boolean): Promise<void> {
    const request = this.active;
    this.active = null;
    this.suggestion = "";
    this.errorCode = null;
    this.phase = phase;
    this.refreshView();
    if (request === null || request.streamDone) {
      return;
    }
    try {
      await this.sendCancel(request.completionId);
    } catch (error) {
      this.errorCode = errorCodeOf(error);
      this.refreshView();
      if (propagateCancelError) {
        throw error;
      }
    }
  }

  private supersedeActive(): void {
    const request = this.active;
    this.active = null;
    if (request === null || request.streamDone) {
      return;
    }
    this.track(
      this.sendCancel(request.completionId).then(
        () => undefined,
        (error: unknown) => {
          this.errorCode = errorCodeOf(error);
          this.refreshView();
        },
      ),
    );
  }

  private sendCancel(completionId: string): Promise<CompletionCancelResult> {
    const params: CompletionCancelParams = { completionId };
    this.rpcCalls.push({ method: RPC_METHOD.COMPLETION_CANCEL, params });
    return this.port.cancel(params);
  }

  private startRequest(params: CompletionStartParams): void {
    const request: ActiveRequest = { completionId: params.completionId, streamDone: false };
    this.active = request;
    this.lastCompletionId = params.completionId;
    this.phase = "requesting";
    this.refreshView();
    this.rpcCalls.push({ method: RPC_METHOD.COMPLETION_START, params });
    let stream: GhostTextStream;
    try {
      stream = this.port.start(params);
    } catch (error) {
      this.fail(request, error);
      return;
    }
    this.track(this.consume(request, stream));
  }

  private async consume(request: ActiveRequest, stream: GhostTextStream): Promise<void> {
    try {
      for await (const { payload } of stream) {
        if (this.active !== request) {
          return;
        }
        this.applyEvent(request, payload);
        if (this.active !== request) {
          return;
        }
      }
    } catch (error) {
      this.fail(request, error);
      return;
    }
    if (this.active === request && !request.streamDone) {
      this.fail(request, undefined);
    }
  }

  private applyEvent(request: ActiveRequest, payload: CompletionEventPayload): void {
    switch (payload.type) {
      case COMPLETION_EVENT_TYPE.STARTED:
        return;
      case COMPLETION_EVENT_TYPE.DELTA: {
        const have = this.suggestion.length;
        if (payload.offset > have) {
          this.fail(
            request,
            invalidState("Delta fora de ordem no stream de completion.", [
              String(payload.offset),
              String(have),
            ]),
          );
          return;
        }
        if (payload.offset + payload.deltaText.length > have) {
          this.suggestion += payload.deltaText.slice(have - payload.offset);
        }
        this.phase = this.suggestion.length > 0 ? "suggesting" : "requesting";
        break;
      }
      case COMPLETION_EVENT_TYPE.COMPLETED:
        request.streamDone = true;
        this.suggestion = payload.text;
        this.phase = payload.text.length > 0 ? "suggesting" : "idle";
        if (payload.text.length === 0) {
          this.active = null;
        }
        break;
      case COMPLETION_EVENT_TYPE.CANCELLED:
        request.streamDone = true;
        this.active = null;
        this.suggestion = "";
        this.phase = "cancelled";
        break;
      case COMPLETION_EVENT_TYPE.INCOMPLETE:
        request.streamDone = true;
        this.active = null;
        this.suggestion = "";
        this.errorCode = payload.code;
        this.phase = "idle";
        break;
    }
    this.refreshView();
  }

  private fail(request: ActiveRequest, error: unknown): void {
    if (this.active !== request) {
      return;
    }
    this.active = null;
    this.suggestion = "";
    this.errorCode = errorCodeOf(error);
    this.phase = "idle";
    this.refreshView();
  }

  private track(task: Promise<void>): void {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }

  private buildView(): GhostTextViewSnapshot {
    return buildGhostTextView({
      phase: this.phase,
      bufferText: this.bufferText,
      cursor: this.cursor,
      suggestion: this.suggestion,
      completionId: this.lastCompletionId,
      errorCode: this.errorCode,
    });
  }

  private refreshView(): void {
    this.view = this.buildView();
  }
}
