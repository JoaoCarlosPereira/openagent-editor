import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_ERROR_CODES,
  isProtocolError,
  refuseToolInTerminalRunError,
} from "@openagent/protocol";
import { RunStateMachine } from "../../src/state/run-state-machine.js";

test("[STA-01] ciclo feliz: idle → running → completed → mensagem nova → idle → running", () => {
  const machine = new RunStateMachine();
  machine.start();
  assert.deepEqual(machine.snapshot(), {
    lifecycleState: "running",
    awaitingNewUserMessage: false,
  });
  machine.complete();
  assert.deepEqual(machine.snapshot(), {
    lifecycleState: "completed",
    awaitingNewUserMessage: true,
  });
  machine.onNewUserMessage();
  assert.deepEqual(machine.snapshot(), {
    lifecycleState: "idle",
    awaitingNewUserMessage: false,
  });
  machine.start();
  assert.equal(machine.snapshot().lifecycleState, "running");
});

test("[STA-01] execução concluída recusa nova ferramenta com INVALID_STATE até nova mensagem", () => {
  const machine = new RunStateMachine();
  machine.start();
  machine.complete();
  try {
    machine.assertMayDispatchTool();
    assert.fail("esperava recusa de ferramenta");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(error.hints?.runState, "completed");
    assert.equal(error.hints?.requiresNewUserMessage, true);
  }
  assert.deepEqual(machine.snapshot(), {
    lifecycleState: "completed",
    awaitingNewUserMessage: true,
  });
});

test("[STA-01] execução cancelada recusa nova ferramenta com INVALID_STATE até nova mensagem", () => {
  const machine = new RunStateMachine();
  machine.start();
  machine.cancel();
  try {
    machine.assertMayDispatchTool();
    assert.fail("esperava recusa de ferramenta");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    assert.equal(error.hints?.runState, "cancelled");
  }
});

test("[STA-01] transição inválida complete a partir de idle retorna INVALID_STATE sem efeito colateral", () => {
  const machine = new RunStateMachine();
  const before = machine.snapshot();
  try {
    machine.complete();
    assert.fail("esperava INVALID_STATE");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
  assert.deepEqual(machine.snapshot(), before);
});

test("[STA-01] transição inválida start em execução running retorna INVALID_STATE sem mutar estado", () => {
  const machine = new RunStateMachine();
  machine.start();
  const before = machine.snapshot();
  try {
    machine.start();
    assert.fail("esperava INVALID_STATE");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
  assert.deepEqual(machine.snapshot(), before);
});

test("[STA-01] start após terminal sem mensagem nova é INVALID_STATE", () => {
  const machine = new RunStateMachine("cancelled");
  assert.equal(machine.snapshot().awaitingNewUserMessage, true);
  try {
    machine.start();
    assert.fail("esperava INVALID_STATE");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }
  assert.equal(machine.snapshot().lifecycleState, "cancelled");
});

test("[STA-01] refuseToolInTerminalRunError permanece alinhado ao assertMayDispatchTool", () => {
  const direct = refuseToolInTerminalRunError("completed");
  const machine = new RunStateMachine();
  machine.start();
  machine.complete();
  try {
    machine.assertMayDispatchTool();
  } catch (fromMachine) {
    assert.ok(isProtocolError(fromMachine));
    assert.equal(fromMachine.code, direct.code);
    assert.equal(fromMachine.hints?.requiresNewUserMessage, true);
  }
});
