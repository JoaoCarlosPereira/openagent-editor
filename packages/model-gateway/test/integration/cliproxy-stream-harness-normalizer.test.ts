import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateHarnessEventStream,
} from "@openagent/protocol";

import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
  assertCliProxyStreamHarnessNormalizerInput,
  consumeOpenAiSseResponse,
  mapCliProxyChatCompletionHttpFailure,
  toHarnessEventFromNormalization,
  type CliProxyStreamHarnessNormalization,
} from "../../src/cliproxy-stream-harness-normalizer.js";

const RUN_ID = "run-stream-normalize-100";
const SESSION_ID = "sess-stream-100";
const MESSAGE_ID = "msg-assistant-100";

function createNormalizer(startingSequence = 1): CliProxyStreamHarnessNormalizer {
  return new CliProxyStreamHarnessNormalizer({
    runId: RUN_ID,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    startingSequence,
    now: () => 1_731_000_100_000,
  });
}

async function withMockChatCompletionsServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      handler(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("[API-02] falha do provedor expõe causa e preserva prompt/diff via HarnessEvent provider.failure", async () => {
  await withMockChatCompletionsServer((_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "429 Too Many Requests" } }));
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "oi" }], stream: true }),
    });

    assert.equal(response.ok, false);
    const bodyText = await response.text();
    const mapped = mapCliProxyChatCompletionHttpFailure(response.status, bodyText);
    assert.equal(mapped.code, "PROVIDER_RATE_LIMIT");
    assert.equal(mapped.hints?.providerCause, "429 Too Many Requests");
    assert.equal(mapped.hints?.preservePrompt, true);
    assert.equal(mapped.hints?.preserveDiff, true);

    const normalizer = createNormalizer();
    const failureEvent = normalizer.buildProviderFailureNormalization(mapped);
    assert.equal(failureEvent.type, CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE);
    assert.equal(failureEvent.payload.providerCause, "429 Too Many Requests");
    assert.equal(failureEvent.payload.preservePrompt, true);
    assert.equal(failureEvent.payload.preserveDiff, true);
  });
});

test("[ERR-03] queda durante streaming marca message.incomplete e retry idempotente", async () => {
  await withMockChatCompletionsServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write('data: {"choices":[{"delta":{"content":"parcial"}}]}\n\n');
    res.end();
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "oi" }], stream: true }),
    });
    assert.equal(response.ok, true);

    const normalizer = createNormalizer();
    const collected: CliProxyStreamHarnessNormalization[] = [];

    await consumeOpenAiSseResponse(response.body, normalizer, (item) => {
      collected.push(item);
    });

    const { normalization, error } = normalizer.markStreamInterrupted();
    collected.push(normalization);

    assert.equal(error.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
    assert.equal(error.hints?.idempotentRetry, true);
    assert.equal(error.hints?.skipRepeatedMutations, true);

    const incomplete = collected.at(-1);
    assert.equal(incomplete?.type, CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_INCOMPLETE);
    assert.equal(incomplete?.payload.status, "incomplete");
    assert.equal(incomplete?.payload.text, "parcial");
    assert.equal(incomplete?.payload.idempotentRetry, true);
    assert.equal(incomplete?.payload.skipRepeatedMutations, true);
    assert.equal(incomplete?.payload.preservePrompt, true);
    assert.equal(incomplete?.payload.preserveDiff, true);
  });
});

test("[API-02] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  assert.throws(
    () =>
      assertCliProxyStreamHarnessNormalizerInput({
        runId: "",
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.deepEqual(error.details, ["runId"]);
      return true;
    },
  );

  const normalizer = createNormalizer();
  const before = normalizer.nextSequence;
  assert.throws(
    () => normalizer.pushSseDataPayload("{not-json"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(normalizer.nextSequence, before);
});

test("stream completo emite message.delta ordenado e HarnessEvent válido", async () => {
  const normalizer = createNormalizer();
  const items = [
    ...normalizer.pushSseDataPayload('{"choices":[{"delta":{"content":"Ol"}}]}'),
    ...normalizer.pushSseDataPayload('{"choices":[{"delta":{"content":"á"}}]}'),
    ...normalizer.pushSseDataPayload("[DONE]"),
  ];

  assert.deepEqual(
    items.map((item) => item.type),
    [
      CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_DELTA,
      CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_DELTA,
      CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_COMPLETED,
    ],
  );
  assert.equal(normalizer.textAccumulated, "Olá");

  const harnessEvents = items.map((item, index) =>
    toHarnessEventFromNormalization(RUN_ID, item, `sha256:payload-${index}`),
  );
  const streamCheck = validateHarnessEventStream(harnessEvents);
  assert.equal(streamCheck.valid, true);
});

test("consumeOpenAiSseResponse propaga PROVIDER_* inline no SSE", async () => {
  const sseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: {"error":{"message":"upstream deadline exceeded","type":"timeout"}}\n\n',
        ),
      );
      controller.close();
    },
  });
  const normalizer = createNormalizer();
  const seen: string[] = [];

  await assert.rejects(
    () =>
      consumeOpenAiSseResponse(sseBody, normalizer, (item) => {
        seen.push(item.type);
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PROVIDER_TIMEOUT");
      return true;
    },
  );

  assert.deepEqual(seen, [CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE]);
});
