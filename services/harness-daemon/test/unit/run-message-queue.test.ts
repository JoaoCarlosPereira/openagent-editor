import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_ERROR_CODES, isProtocolError } from "@openagent/protocol";
import { RunMessageQueue } from "../../src/queue/run-message-queue.js";

test("[AGT-06] mensagem durante execução entra na fila em ordem e remove só item pendente", () => {
  const queue = new RunMessageQueue();
  const runId = "run-1";

  const first = queue.enqueue({
    runLifecycleState: "running",
    runId,
    input: { text: "primeira" },
  });
  const second = queue.enqueue({
    runLifecycleState: "running",
    runId,
    input: { text: "segunda" },
  });

  assert.ok(first.ordinal < second.ordinal);
  assert.deepEqual(queue.pendingInOrder().map((item) => item.queueItemId), [
    first.queueItemId,
    second.queueItemId,
  ]);

  const removed = queue.removePending(second.queueItemId, "running");
  assert.equal(removed.queueItemId, second.queueItemId);
  assert.deepEqual(queue.pendingInOrder().map((item) => item.queueItemId), [
    first.queueItemId,
  ]);
});

test("[AGT-06] remover item já iniciado retorna INVALID_STATE sem alterar a fila", () => {
  const queue = new RunMessageQueue();
  const runId = "run-2";
  const item = queue.enqueue({
    runLifecycleState: "running",
    runId,
    input: { text: "em consumo" },
  });
  queue.markStarted(item.queueItemId);
  const before = queue.snapshot();

  try {
    queue.removePending(item.queueItemId, "running");
    assert.fail("esperava INVALID_STATE");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  assert.deepEqual(queue.snapshot(), before);
});

test("[AGT-06] enfileirar fora de execução running retorna INVALID_STATE sem efeito colateral", () => {
  const queue = new RunMessageQueue();
  const before = queue.snapshot();

  for (const state of ["idle", "completed", "cancelled"] as const) {
    try {
      queue.enqueue({
        runLifecycleState: state,
        runId: "run-3",
        input: { text: "tarde demais" },
      });
      assert.fail(`esperava INVALID_STATE para ${state}`);
    } catch (error) {
      assert.ok(isProtocolError(error));
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
    }
  }

  assert.deepEqual(queue.snapshot(), before);
});

test("[AGT-06] entrada inválida na fila retorna INVALID_STATE sem mutar estado", () => {
  const queue = new RunMessageQueue();
  const before = queue.snapshot();

  try {
    queue.enqueue({
      runLifecycleState: "running",
      runId: "run-4",
      input: { text: "   " },
    });
    assert.fail("esperava INVALID_STATE");
  } catch (error) {
    assert.ok(isProtocolError(error));
    assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  assert.deepEqual(queue.snapshot(), before);
});
