import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { streamCliProxyChatText } from "../../src/index.js";

const BASE = {
  endpoint: "http://127.0.0.1:1",
  model: "m",
  credential: "k",
  messages: [{ role: "user" as const, content: "oi" }],
  runId: "run-1",
  sessionId: "ses-1",
  messageId: "msg-1",
};

function sseResponse(chunks: string[], keepOpen?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      if (keepOpen) {
        keepOpen.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

async function drain(iterable: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

test("stream entrega deltas de texto e termina em [DONE]", async () => {
  const controller = new AbortController();
  const texts = await drain(
    streamCliProxyChatText({
      ...BASE,
      signal: controller.signal,
      fetchImpl: async () => sseResponse([delta("a"), delta("b"), "data: [DONE]\n\n"]),
    }),
  );
  assert.deepEqual(texts, ["a", "b"]);
});

test("stream sem [DONE] vira INCOMPLETE_STREAM", async () => {
  const controller = new AbortController();
  await assert.rejects(
    drain(
      streamCliProxyChatText({
        ...BASE,
        signal: controller.signal,
        fetchImpl: async () => sseResponse([delta("a")]),
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
      return true;
    },
  );
});

test("aborto interrompe a leitura sem mapear o cancelamento para erro de provedor", async () => {
  const controller = new AbortController();
  const iterator = streamCliProxyChatText({
    ...BASE,
    signal: controller.signal,
    fetchImpl: async () => sseResponse([delta("a")], controller.signal),
  })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.value, "a");
  const pending = iterator.next();
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(!(error instanceof ProtocolError));
    return true;
  });
});

test("HTTP 401 redige credencial ecoada e qualquer Bearer da mensagem e hints", async () => {
  const controller = new AbortController();
  const credential = "secret-credential-0987654321";
  const bearer = "Bearer second-token-abcdefghijk";
  const body = JSON.stringify({
    error: { message: `Incorrect API key provided: ${credential}; authorization ${bearer}` },
  });
  await assert.rejects(
    drain(
      streamCliProxyChatText({
        ...BASE,
        credential,
        signal: controller.signal,
        fetchImpl: async () => new Response(body, { status: 401 }),
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.match(error.code, /^PROVIDER_/);
      assert.ok(!error.message.includes(credential));
      assert.ok(!error.message.includes("second-token-abcdefghijk"));
      assert.equal(error.hints?.providerCause, error.message);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});

test("HTTP provider failure sem eco preserva causa útil sem credencial", async () => {
  const controller = new AbortController();
  await assert.rejects(
    drain(
      streamCliProxyChatText({
        ...BASE,
        signal: controller.signal,
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), { status: 429 }),
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PROVIDER_RATE_LIMIT");
      assert.equal(error.message, "rate limit exceeded");
      assert.equal(error.hints?.providerCause, "rate limit exceeded");
      return true;
    },
  );
});
