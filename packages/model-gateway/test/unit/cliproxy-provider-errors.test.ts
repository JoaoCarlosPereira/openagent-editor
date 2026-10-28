import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
  mapCliProxyChatCompletionHttpFailure,
  mapCliProxyOpenAiHttpFailure,
  probeCliProxyOpenAiCompatibleProvider,
} from "../../src/index.js";

test("[API-02] timeout HTTP (504) normaliza para PROVIDER_TIMEOUT", () => {
  const mapped = mapCliProxyOpenAiHttpFailure(
    504,
    JSON.stringify({ error: { message: "Gateway Timeout upstream" } }),
  );
  assert.equal(mapped.code, "PROVIDER_TIMEOUT");
  assert.equal(mapped.hints?.providerCause, "Gateway Timeout upstream");
  assert.equal(mapped.hints?.preservePrompt, true);
  assert.equal(mapped.hints?.preserveDiff, true);
});

test("[API-02] chat/completions HTTP failure expõe HarnessEvent provider.failure", () => {
  const mapped = mapCliProxyChatCompletionHttpFailure(
    408,
    JSON.stringify({ error: { message: "request timeout" } }),
  );
  assert.equal(mapped.code, "PROVIDER_TIMEOUT");

  const normalizer = new CliProxyStreamHarnessNormalizer({
    runId: "run-101",
    sessionId: "sess-101",
    messageId: "msg-101",
    now: () => 1_731_000_200_000,
  });
  const failureEvent = normalizer.buildProviderFailureNormalization(mapped);
  assert.equal(failureEvent.type, CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE);
  assert.equal(failureEvent.payload.providerCause, "request timeout");
  assert.equal(failureEvent.payload.preservePrompt, true);
  assert.equal(failureEvent.payload.preserveDiff, true);
});

test("[API-02] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  await assert.rejects(
    () =>
      probeCliProxyOpenAiCompatibleProvider({
        profileId: "",
        model: "m",
        credential: "c",
        endpoint: "http://127.0.0.1:9/v1",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.deepEqual(error.details, ["profileId"]);
      return true;
    },
  );
});
