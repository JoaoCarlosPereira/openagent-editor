import {
  HARNESS_EVENT_SCHEMA_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  incompleteStreamError,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  assertNonEmptyCliProxyField,
  mapCliProxyInlineStreamErrorObject,
  providerFailurePreservationHints,
} from "./cliproxy-provider-errors.js";

export {
  mapCliProxyChatCompletionHttpFailure,
  mapCliProxyOpenAiHttpFailure,
} from "./cliproxy-provider-errors.js";

export const CLI_PROXY_STREAM_HARNESS_EVENT_TYPES = {
  MESSAGE_DELTA: "message.delta",
  MESSAGE_COMPLETED: "message.completed",
  MESSAGE_INCOMPLETE: "message.incomplete",
  PROVIDER_FAILURE: "provider.failure",
} as const;

export type CliProxyStreamHarnessNormalizerInput = {
  runId: string;
  sessionId: string;
  messageId: string;
  startingSequence?: number;
  now?: () => number;
};

export type CliProxyStreamHarnessNormalization = {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
};

type OpenAiStreamChunk = {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertCliProxyStreamHarnessNormalizerInput(
  input: CliProxyStreamHarnessNormalizerInput,
): CliProxyStreamHarnessNormalizerInput {
  return {
    runId: assertNonEmptyCliProxyField(input.runId, "runId"),
    sessionId: assertNonEmptyCliProxyField(input.sessionId, "sessionId"),
    messageId: assertNonEmptyCliProxyField(input.messageId, "messageId"),
    startingSequence: input.startingSequence,
    now: input.now,
  };
}

export function toHarnessEventFromNormalization(
  runId: string,
  item: CliProxyStreamHarnessNormalization,
  payloadRef: string,
): HarnessEvent {
  return {
    sequence: item.sequence,
    runId,
    type: item.type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: item.timestamp,
  };
}

export class CliProxyStreamHarnessNormalizer {
  public readonly runId: string;
  public readonly sessionId: string;
  public readonly messageId: string;

  private readonly now: () => number;
  private sequence: number;
  private accumulatedText = "";
  private streamOpened = false;
  private closed = false;

  constructor(input: CliProxyStreamHarnessNormalizerInput) {
    const normalized = assertCliProxyStreamHarnessNormalizerInput(input);
    this.runId = normalized.runId;
    this.sessionId = normalized.sessionId;
    this.messageId = normalized.messageId;
    this.sequence = normalized.startingSequence ?? 1;
    this.now = normalized.now ?? (() => Date.now());
  }

  get nextSequence(): number {
    return this.sequence;
  }

  get textAccumulated(): string {
    return this.accumulatedText;
  }

  get isStreamClosed(): boolean {
    return this.closed;
  }

  get hasStreamStarted(): boolean {
    return this.streamOpened;
  }

  private emit(type: string, payload: Record<string, unknown>): CliProxyStreamHarnessNormalization {
    const item: CliProxyStreamHarnessNormalization = {
      sequence: this.sequence,
      type,
      payload,
      timestamp: this.now(),
    };
    this.sequence += 1;
    return item;
  }

  private basePayload(): Record<string, unknown> {
    return {
      runId: this.runId,
      sessionId: this.sessionId,
      messageId: this.messageId,
      role: "assistant",
      ...providerFailurePreservationHints(),
    };
  }

  /**
   * Processa uma linha `data:` de SSE OpenAI-compatible vinda do CLIProxyAPI.
   */
  pushSseDataPayload(rawData: string): CliProxyStreamHarnessNormalization[] {
    if (this.closed) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Stream de modelo já foi fechado.",
      );
    }

    const data = rawData.trim();
    if (!data || data === "[DONE]") {
      if (data === "[DONE]") {
        this.closed = true;
        if (!this.streamOpened) {
          return [];
        }
        return [
          this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_COMPLETED, {
            ...this.basePayload(),
            status: "completed",
            text: this.accumulatedText,
          }),
        ];
      }
      return [];
    }

    let parsed: OpenAiStreamChunk;
    try {
      parsed = JSON.parse(data) as OpenAiStreamChunk;
    } catch {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Chunk SSE do provedor não é JSON válido.",
        ["sse.data"],
      );
    }

    if (parsed.error) {
      const failure = mapCliProxyInlineStreamErrorObject(parsed.error);
      this.closed = true;
      throw failure;
    }

    const deltaText = parsed.choices?.[0]?.delta?.content ?? "";
    if (typeof deltaText !== "string" || deltaText.length === 0) {
      return [];
    }

    this.streamOpened = true;
    this.accumulatedText += deltaText;
    return [
      this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_DELTA, {
        ...this.basePayload(),
        deltaText,
        accumulatedText: this.accumulatedText,
      }),
    ];
  }

  /**
   * ERR-03: conexão caiu antes de [DONE] — marca resposta incompleta e permite retry idempotente.
   */
  markStreamInterrupted(): {
    normalization: CliProxyStreamHarnessNormalization;
    error: ProtocolError;
  } {
    if (this.closed) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Stream de modelo já foi fechado.",
      );
    }
    this.closed = true;
    const error = incompleteStreamError();
    const normalization = this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_INCOMPLETE, {
      ...this.basePayload(),
      status: "incomplete",
      text: this.accumulatedText,
      idempotentRetry: error.hints?.idempotentRetry === true,
      skipRepeatedMutations: error.hints?.skipRepeatedMutations === true,
    });
    return { normalization, error };
  }

  buildProviderFailureNormalization(error: ProtocolError): CliProxyStreamHarnessNormalization {
    const hints = providerFailurePreservationHints();
    if (this.closed) {
      return this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE, {
        ...this.basePayload(),
        code: error.code,
        providerCause: error.hints?.providerCause ?? error.message,
        ...hints,
      });
    }
    this.closed = true;
    return this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE, {
      ...this.basePayload(),
      code: error.code,
      providerCause: error.hints?.providerCause ?? error.message,
      text: this.accumulatedText,
      ...hints,
    });
  }
}

export async function consumeOpenAiSseResponse(
  body: ReadableStream<Uint8Array> | null,
  normalizer: CliProxyStreamHarnessNormalizer,
  onNormalization: (item: CliProxyStreamHarnessNormalization) => void,
): Promise<void> {
  if (!body) {
    const { error } = normalizer.markStreamInterrupted();
    throw error;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) {
          continue;
        }
        const payload = line.slice("data:".length);
        for (const item of normalizer.pushSseDataPayload(payload)) {
          onNormalization(item);
        }
      }
    }

    if (buffer.trim().length > 0 && buffer.startsWith("data:")) {
      for (const item of normalizer.pushSseDataPayload(buffer.slice("data:".length))) {
        onNormalization(item);
      }
    }
  } catch (error) {
    if (error instanceof ProtocolError && error.code.startsWith("PROVIDER_")) {
      onNormalization(normalizer.buildProviderFailureNormalization(error));
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (normalizer.hasStreamStarted && !normalizer.isStreamClosed) {
    const { normalization, error } = normalizer.markStreamInterrupted();
    onNormalization(normalization);
    throw error;
  }
}

export function parseOpenAiStreamErrorObject(raw: unknown): ProtocolError | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const error = raw["error"];
  if (!isRecord(error)) {
    return undefined;
  }
  return mapCliProxyInlineStreamErrorObject(error as OpenAiStreamChunk["error"]);
}
