import { incompleteStreamError } from "@openagent/protocol";

import {
  mapCliProxyFetchNetworkError,
  mapCliProxyOpenAiHttpFailure,
} from "./cliproxy-provider-errors.js";
import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
} from "./cliproxy-stream-harness-normalizer.js";

export type CliProxyChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamCliProxyChatTextInput = {
  /** Base OpenAI-compat do CLIProxyAPI (com ou sem `/v1`). */
  endpoint: string;
  model: string;
  credential: string;
  messages: readonly CliProxyChatMessage[];
  /** Cancelamento: aborta a requisição HTTP e libera o reader do stream. */
  signal: AbortSignal;
  runId: string;
  sessionId: string;
  messageId: string;
  fetchImpl?: typeof fetch;
};

function chatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/$/, "");
  return `${trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`}/chat/completions`;
}

/**
 * Stream de texto do chat/completions (SSE) com cancelamento por AbortSignal.
 * Falhas do provedor viram PROVIDER_*; fim sem `[DONE]` vira INCOMPLETE_STREAM (ERR-03).
 * Um abort propaga o AbortError original para o chamador decidir o estado terminal.
 */
export async function* streamCliProxyChatText(
  input: StreamCliProxyChatTextInput,
): AsyncGenerator<string, void, void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(chatCompletionsUrl(input.endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${input.credential}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: true,
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) {
      throw error;
    }
    throw mapCliProxyFetchNetworkError("chat.completions");
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw mapCliProxyOpenAiHttpFailure(
      response.status,
      bodyText,
      `Provedor recusou o pedido de completion (${response.status}).`,
    );
  }
  if (!response.body) {
    throw incompleteStreamError();
  }

  const normalizer = new CliProxyStreamHarnessNormalizer({
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: input.messageId,
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const textFromLine = (line: string): string[] => {
    if (!line.startsWith("data:")) {
      return [];
    }
    return normalizer
      .pushSseDataPayload(line.slice("data:".length))
      .filter((item) => item.type === CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_DELTA)
      .map((item) => String(item.payload["deltaText"] ?? ""));
  };

  try {
    while (!normalizer.isStreamClosed) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (input.signal.aborted) {
          throw error;
        }
        throw incompleteStreamError();
      }
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const text of textFromLine(line)) {
          yield text;
        }
      }
    }
    if (!normalizer.isStreamClosed && buffer.length > 0) {
      for (const text of textFromLine(buffer)) {
        yield text;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!normalizer.isStreamClosed) {
    throw incompleteStreamError();
  }
}
