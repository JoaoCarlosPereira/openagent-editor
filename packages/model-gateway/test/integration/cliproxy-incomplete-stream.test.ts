import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  incompleteStreamError,
} from "@openagent/protocol";

import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
  consumeOpenAiSseResponse,
  resolveCliProxyIncompleteStreamRetry,
  assertIncompleteStreamRunStateUnchanged,
  type CliProxyStreamHarnessNormalization,
} from "../../src/index.js";

const RUN_ID = "run-incomplete-103";
const SESSION_ID = "sess-incomplete-103";
const MESSAGE_ID = "msg-incomplete-103";

function createNormalizer(): CliProxyStreamHarnessNormalizer {
  return new CliProxyStreamHarnessNormalizer({
    runId: RUN_ID,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    startingSequence: 1,
    now: () => 1_731_000_400_000,
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

test("[ERR-03] Stream incompleto em INCOMPLETE_STREAM com retry idempotente", async () => {
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
      body: JSON.stringify({
        model: "gpt-test",
        messages: [{ role: "user", content: "oi" }],
        stream: true,
      }),
    });
    assert.equal(response.ok, true);

    const normalizer = createNormalizer();
    const collected: CliProxyStreamHarnessNormalization[] = [];

    await assert.rejects(
      () =>
        consumeOpenAiSseResponse(response.body, normalizer, (item) => {
          collected.push(item);
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
        assert.equal(error.hints?.idempotentRetry, true);
        assert.equal(error.hints?.skipRepeatedMutations, true);
        return true;
      },
    );

    const incomplete = collected.find(
      (item) => item.type === CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_INCOMPLETE,
    );
    assert.ok(incomplete);
    assert.equal(incomplete.payload.status, "incomplete");
    assert.equal(incomplete.payload.text, "parcial");
    assert.equal(incomplete.payload.idempotentRetry, true);
    assert.equal(incomplete.payload.skipRepeatedMutations, true);

    const runState = {
      partialAssistantText: "parcial",
      persistedMutationIds: ["mut-applied-1", "mut-applied-2"],
    };
    const before = { ...runState, persistedMutationIds: [...runState.persistedMutationIds] };

    const retry = resolveCliProxyIncompleteStreamRetry(
      incompleteStreamError(),
      incomplete,
      runState,
      ["mut-applied-1", "mut-applied-3", "mut-applied-2"],
    );
    assert.equal(retry.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
    assert.equal(retry.partialAssistantText, "parcial");
    assert.deepEqual(retry.skipMutationIds, ["mut-applied-1", "mut-applied-2"]);
    assert.equal(retry.idempotentRetry, true);
    assert.equal(retry.skipRepeatedMutations, true);

    assertIncompleteStreamRunStateUnchanged(before, {
      ...runState,
      persistedMutationIds: [...runState.persistedMutationIds],
    });
  });
});

test("[ERR-03] Caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const normalizer = createNormalizer();
  normalizer.pushSseDataPayload('{"choices":[{"delta":{"content":"x"}}]}');
  normalizer.pushSseDataPayload("[DONE]");

  const runState = {
    partialAssistantText: "x",
    persistedMutationIds: ["mut-1"],
  };
  const before = { ...runState, persistedMutationIds: [...runState.persistedMutationIds] };

  const invalid = new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Estado inválido.");
  const fakeEvent = {
    sequence: 9,
    type: CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_DELTA,
    payload: { status: "completed" },
    timestamp: 1,
  };

  assert.throws(
    () => resolveCliProxyIncompleteStreamRetry(invalid, fakeEvent, runState, []),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => normalizer.markStreamInterrupted(),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assertIncompleteStreamRunStateUnchanged(before, {
    ...runState,
    persistedMutationIds: [...runState.persistedMutationIds],
  });
});
