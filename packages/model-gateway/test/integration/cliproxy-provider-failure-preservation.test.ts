import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  CliProxyStreamHarnessNormalizer,
  loadCliProxyProviderErrorFixtures,
  mapCliProxyOpenAiHttpFailure,
  resolveCliProxyProviderFailurePreservation,
  assertProviderFailureEditorStateUnchanged,
} from "../../src/index.js";

const SAMPLE_STATE = {
  draftPrompt: "Corrija o handler de login sem apagar meu rascunho.",
  producedDiff: "@@ -1,3 +1,4 @@\n contexto\n+novo trecho\n",
};

test("[API-02] Falha preserva prompt digitado e diff já produzido (fixtures sidecar)", () => {
  const fixtures = loadCliProxyProviderErrorFixtures();
  assert.match(fixtures.description, /PROVIDER_/);

  for (const [name, sample] of Object.entries(fixtures.samples)) {
    const before = { ...SAMPLE_STATE };
    const error = mapCliProxyOpenAiHttpFailure(
      sample.httpStatus,
      JSON.stringify(sample.body),
    );
    assert.equal(error.code, sample.expectedCode, name);

    const outcome = resolveCliProxyProviderFailurePreservation(error, before);
    assert.equal(outcome.displayCause, sample.body.error?.message ?? "", name);
    assert.equal(outcome.draftPrompt, before.draftPrompt, name);
    assert.equal(outcome.producedDiff, before.producedDiff, name);
    assert.equal(outcome.preservePrompt, true, name);
    assert.equal(outcome.preserveDiff, true, name);

    assertProviderFailureEditorStateUnchanged(before, {
      draftPrompt: outcome.draftPrompt,
      producedDiff: outcome.producedDiff,
    });
  }
});

test("[API-02] streaming parcial + provider.failure conserva diff acumulado e prompt", () => {
  const normalizer = new CliProxyStreamHarnessNormalizer({
    runId: "run-102",
    sessionId: "sess-102",
    messageId: "msg-102",
    startingSequence: 4,
    now: () => 1_731_000_300_000,
  });

  normalizer.pushSseDataPayload(
    JSON.stringify({ choices: [{ delta: { content: "@@ diff parcial\n" } }] }),
  );

  const mapped = mapCliProxyOpenAiHttpFailure(
    429,
    JSON.stringify({ error: { message: "429 Too Many Requests" } }),
  );
  const failureEvent = normalizer.buildProviderFailureNormalization(mapped);
  assert.equal(failureEvent.type, CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.PROVIDER_FAILURE);
  assert.equal(failureEvent.payload.text, "@@ diff parcial\n");

  const before = { ...SAMPLE_STATE };
  const outcome = resolveCliProxyProviderFailurePreservation(mapped, before);
  assert.equal(outcome.displayCause, "429 Too Many Requests");
  assert.equal(outcome.draftPrompt, SAMPLE_STATE.draftPrompt);
  assert.equal(outcome.producedDiff, SAMPLE_STATE.producedDiff);
});

test("[API-02] Caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const before = { ...SAMPLE_STATE };
  const invalid = new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Estado inválido.",
  );

  assert.throws(
    () => resolveCliProxyProviderFailurePreservation(invalid, before),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assertProviderFailureEditorStateUnchanged(before, { ...before });
});
