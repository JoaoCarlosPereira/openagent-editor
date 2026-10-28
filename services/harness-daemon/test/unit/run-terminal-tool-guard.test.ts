import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_ERROR_CODES,
  isProtocolError,
} from "@openagent/protocol";
import { assertMayDispatchToolForLifecycle } from "../../src/state/terminal-run-tool-guard.js";
import { RunStateMachine } from "../../src/state/run-state-machine.js";

test("[STA-01] guard recusa ferramenta em completed até mensagem nova", () => {
  try {
    assertMayDispatchToolForLifecycle("completed");
    assert.fail("esperava recusa");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(error.hints?.runState, "completed");
    assert.equal(error.hints?.requiresNewUserMessage, true);
  }
});

test("[STA-01] guard recusa ferramenta em cancelled até mensagem nova", () => {
  try {
    assertMayDispatchToolForLifecycle("cancelled");
    assert.fail("esperava recusa");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(error.hints?.runState, "cancelled");
    assert.equal(error.hints?.requiresNewUserMessage, true);
  }
});

test("[STA-01] guard permite ferramenta somente com execução running", () => {
  assert.doesNotThrow(() => assertMayDispatchToolForLifecycle("running"));
  try {
    assertMayDispatchToolForLifecycle("idle");
    assert.fail("esperava INVALID_STATE em idle");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
});

test("[STA-01] após mensagem nova e novo start, ferramenta volta a ser permitida", () => {
  const machine = new RunStateMachine();
  machine.start();
  machine.complete();
  machine.onNewUserMessage();
  machine.start();
  assert.doesNotThrow(() => machine.assertMayDispatchTool());
  assert.doesNotThrow(() =>
    assertMayDispatchToolForLifecycle(machine.snapshot().lifecycleState),
  );
});
