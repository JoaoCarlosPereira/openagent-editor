import assert from "node:assert/strict";
import test from "node:test";

import { providerFailureError } from "@openagent/protocol";

import { resolveCliProxyProviderFailurePreservation } from "../../src/cliproxy-provider-failure-preservation.js";

test("[API-02] resolveCliProxyProviderFailurePreservation expõe causa sem mutar estado", () => {
  const state = { draftPrompt: "  texto  ", producedDiff: null };
  const error = providerFailureError("timeout", "Gateway Timeout upstream");
  const outcome = resolveCliProxyProviderFailurePreservation(error, state);
  assert.equal(outcome.code, "PROVIDER_TIMEOUT");
  assert.equal(outcome.displayCause, "Gateway Timeout upstream");
  assert.equal(outcome.draftPrompt, "  texto  ");
  assert.equal(outcome.producedDiff, null);
});
