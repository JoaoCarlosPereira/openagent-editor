import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  incompleteStreamError,
  providerFailureError,
} from "@openagent/protocol";

import {
  PROVIDER_RUN_ERROR_FAILURE_MESSAGE,
  PROVIDER_RUN_ERROR_INCOMPLETE_MESSAGE,
  ProviderRunErrorController,
} from "../../src/review/provider-run-error.js";

const PROMPT = "Refatore o módulo de auth sem apagar o diff parcial.";
const DIFF = "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new\n";
const MUTATION_A = "mut-already-written-001";
const MUTATION_B = "mut-already-written-002";

describe("API-02 / ERR-03 e2e — erro de provedor e resposta Incompleta com retry", () => {
  it("[API-02] falha do provedor exibe causa, conserva texto digitado e não apaga diff", () => {
    const ui = new ProviderRunErrorController();
    assert.equal(ui.phase, "idle");
    assert.match(ui.snapshot.html, /data-testid="provider-run-error"/);

    ui.setDraftPrompt(PROMPT);
    ui.setPreservedDiff(DIFF);
    ui.recordPersistedMutation(MUTATION_A);

    const cause = "rate limit: 429 Too Many Requests";
    const view = ui.acceptProviderFailure(providerFailureError("rate_limit", cause));

    assert.equal(view.accessible.phase, "provider_failure");
    assert.equal(view.accessible.responseStatus, "failed");
    assert.equal(view.accessible.message, PROVIDER_RUN_ERROR_FAILURE_MESSAGE);
    assert.equal(view.accessible.errorCode, "PROVIDER_RATE_LIMIT");
    assert.equal(view.accessible.providerCause, cause);
    assert.equal(view.accessible.promptText, PROMPT);
    assert.equal(view.accessible.preservedDiff, DIFF);
    assert.equal(view.accessible.promptCleared, false);
    assert.equal(view.accessible.diffCleared, false);
    assert.equal(view.accessible.canRetry, false);
    assert.match(view.html, /data-testid="provider-run-error-cause"/);
    assert.match(view.html, new RegExp(escapeRegExp(cause)));
    assert.match(view.html, /data-testid="provider-run-error-prompt"/);
    assert.match(view.html, new RegExp(escapeRegExp(PROMPT)));
    assert.match(view.html, /data-testid="provider-run-error-diff"/);
    assert.match(view.html, new RegExp(escapeRegExp("src/auth.ts")));

    const timeoutCause = "upstream timeout after 30s";
    const timeoutView = (() => {
      const next = new ProviderRunErrorController();
      next.setDraftPrompt(PROMPT);
      next.setPreservedDiff(DIFF);
      return next.acceptProviderFailure(providerFailureError("timeout", timeoutCause));
    })();
    assert.equal(timeoutView.accessible.errorCode, "PROVIDER_TIMEOUT");
    assert.equal(timeoutView.accessible.providerCause, timeoutCause);
    assert.equal(timeoutView.accessible.promptText, PROMPT);
    assert.equal(timeoutView.accessible.preservedDiff, DIFF);

    const capabilityCause = "model does not support tool use";
    const capabilityView = (() => {
      const next = new ProviderRunErrorController();
      next.setDraftPrompt(PROMPT);
      next.setPreservedDiff(DIFF);
      return next.acceptProviderFailure(
        providerFailureError("capability_missing", capabilityCause),
      );
    })();
    assert.equal(capabilityView.accessible.errorCode, "PROVIDER_CAPABILITY_MISSING");
    assert.equal(capabilityView.accessible.providerCause, capabilityCause);
    assert.equal(capabilityView.accessible.promptText, PROMPT);
    assert.equal(capabilityView.accessible.preservedDiff, DIFF);
  });

  it("[ERR-03] conexão caída marca Incompleta e retry não repete alteração já gravada", () => {
    const ui = new ProviderRunErrorController();
    ui.setDraftPrompt(PROMPT);
    ui.setPreservedDiff(DIFF);
    ui.recordPersistedMutation(MUTATION_A);
    ui.recordPersistedMutation(MUTATION_B);

    const view = ui.acceptIncompleteStream(incompleteStreamError(), "parcial…");

    assert.equal(view.accessible.phase, "incomplete");
    assert.equal(view.accessible.responseStatus, "incomplete");
    assert.equal(view.accessible.message, PROVIDER_RUN_ERROR_INCOMPLETE_MESSAGE);
    assert.equal(view.accessible.errorCode, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
    assert.equal(view.accessible.canRetry, true);
    assert.equal(view.accessible.promptText, PROMPT);
    assert.equal(view.accessible.preservedDiff, DIFF);
    assert.deepEqual(view.accessible.skipMutationIds, [MUTATION_A, MUTATION_B]);
    assert.match(view.html, /data-status="incomplete"/);
    assert.match(view.html, /Incompleta/);
    assert.match(view.html, /data-testid="provider-run-error-retry"/);

    const retry = ui.requestRetry();
    assert.equal(retry.idempotentRetry, true);
    assert.equal(retry.skipRepeatedMutations, true);
    assert.equal(retry.errorCode, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
    assert.equal(retry.promptText, PROMPT);
    assert.equal(retry.preservedDiff, DIFF);
    assert.deepEqual(retry.skipMutationIds, [MUTATION_A, MUTATION_B]);
    assert.ok(!retry.skipMutationIds.includes("mut-not-yet-written"));

    // Retry não limpa estado observável (sem efeito colateral destrutivo).
    assert.equal(ui.phase, "incomplete");
    assert.equal(ui.snapshot.accessible.promptText, PROMPT);
    assert.equal(ui.snapshot.accessible.preservedDiff, DIFF);
    assert.deepEqual(ui.snapshot.accessible.skipMutationIds, [MUTATION_A, MUTATION_B]);
  });

  it("[API-02] entrada ou estado inválido retorna INVALID_STATE sem efeito colateral", () => {
    const ui = new ProviderRunErrorController();
    ui.setDraftPrompt(PROMPT);
    ui.setPreservedDiff(DIFF);
    const before = ui.snapshot.html;

    assert.throws(() => ui.setDraftPrompt(null), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.throws(() => ui.setPreservedDiff(42), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.throws(() => ui.recordPersistedMutation(""), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.throws(
      () =>
        ui.acceptProviderFailure(
          new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "cancelado"),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () =>
        ui.acceptProviderFailure(
          new ProtocolError("PROVIDER_TIMEOUT", "sem hints", [], {
            preservePrompt: false,
            preserveDiff: false,
          }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () =>
        ui.acceptIncompleteStream(
          new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "não é incompleto"),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(() => ui.requestRetry(), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });

    assert.equal(ui.phase, "idle");
    assert.equal(ui.snapshot.html, before);
    assert.equal(ui.snapshot.accessible.promptText, PROMPT);
    assert.equal(ui.snapshot.accessible.preservedDiff, DIFF);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
