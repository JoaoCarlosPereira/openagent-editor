import {
  HARNESS_EVENT_SCHEMA_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  incompleteStreamError,
  providerFailureError,
  type HarnessEvent,
  type ProviderFailureReason,
} from "@openagent/protocol";

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

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Entrada inválida para normalização de streaming.",
      [label],
    );
  }
  return value.trim();
}

function preservationHints(): Record<string, boolean> {
  return { preservePrompt: true, preserveDiff: true };
}

function parseOpenAiErrorBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "Provedor recusou a requisição de streaming.";
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    const message = parsed.error?.message?.trim();
    if (message) {
      return message;
    }
  } catch {
    // texto bruto abaixo
  }
  return trimmed.slice(0, 500);
}

function inferProviderFailureReason(
  status: number,
  providerCause: string,
): ProviderFailureReason {
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  const lower = providerCause.toLowerCase();
  if (
    lower.includes("rate") ||
    lower.includes("429") ||
    lower.includes("too many")
  ) {
    return "rate_limit";
  }
  if (lower.includes("timeout") || lower.includes("deadline") || lower.includes("expired")) {
    return "timeout";
  }
  if (
    lower.includes("capability") ||
    lower.includes("not support") ||
    lower.includes("unsupported") ||
    lower.includes("model")
  ) {
    return "capability_missing";
  }
  if (status === 404 || status === 422) {
    return "capability_missing";
  }
  return "timeout";
}

/**
 * API-02: mapeia falha HTTP do chat/completions para código estável PROVIDER_* com causa preservada.
 */
export function mapCliProxyChatCompletionHttpFailure(
  status: number,
  bodyText: string,
): ProtocolError {
  const providerCause = parseOpenAiErrorBody(bodyText);
  const reason = inferProviderFailureReason(status, providerCause);
  return providerFailureError(reason, providerCause);
}

function mapInlineStreamError(error: OpenAiStreamChunk["error"]): ProtocolError {
  const providerCause =
    error?.message?.trim() ||
    error?.type?.trim() ||
    "Provedor interrompeu o streaming.";
  const codeHint = String(error?.code ?? error?.type ?? "");
  const reason = inferProviderFailureReason(400, `${providerCause} ${codeHint}`);
  return providerFailureError(reason, providerCause);
}

export function assertCliProxyStreamHarnessNormalizerInput(
  input: CliProxyStreamHarnessNormalizerInput,
): CliProxyStreamHarnessNormalizerInput {
  return {
    runId: requireNonEmptyString(input.runId, "runId"),
    sessionId: requireNonEmptyString(input.sessionId, "sessionId"),
    messageId: requireNonEmptyString(input.messageId, "messageId"),
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
      ...preservationHints(),
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
      const failure = mapInlineStreamError(parsed.error);
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
    if (this.closed) {
      return this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE, {
        ...this.basePayload(),
        code: error.code,
        providerCause: error.hints?.providerCause ?? error.message,
        ...preservationHints(),
      });
    }
    this.closed = true;
    return this.emit(CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE, {
      ...this.basePayload(),
      code: error.code,
      providerCause: error.hints?.providerCause ?? error.message,
      text: this.accumulatedText,
      ...preservationHints(),
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
}

export function parseOpenAiStreamErrorObject(raw: unknown): ProtocolError | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const error = raw["error"];
  if (!isRecord(error)) {
    return undefined;
  }
  return mapInlineStreamError(error as OpenAiStreamChunk["error"]);
}
