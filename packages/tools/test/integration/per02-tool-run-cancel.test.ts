import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError, PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  createTypedToolDispatchRegistry,
  dispatchInIsolatedWorker,
  invalidToolInputError,
  ToolRunCoordinator,
  type ToolHandlerMap,
} from "../../src/index.js";

const demoHandlers = {
  async applyChange(input: unknown) {
    const { label } = input as { label: string };
    return { applied: label };
  },
  async slowWork(input: unknown) {
    const { ms } = input as { ms: number };
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { done: true as const };
  },
  async queuedWork(input: unknown) {
    const { n } = input as { n: number };
    return { n };
  },
} satisfies ToolHandlerMap;

test("[PER-02] cancelamento marca execução cancelada em até 2s, bloqueia nova ferramenta e conserva alteração aplicada", async () => {
  let virtualNow = 1_000;
  const registry = createTypedToolDispatchRegistry(demoHandlers);
  const coordinator = new ToolRunCoordinator(registry, {
    cancelDeadlineMs: 2_000,
    now: () => virtualNow,
  });

  const first = await coordinator.dispatch("applyChange", { label: "patch-a" }, "inv-1");
  assert.deepEqual(first, { applied: "patch-a" });

  const slowPromise = coordinator.dispatch("slowWork", { ms: 400 }, "inv-2");
  const slowExpectation = assert.rejects(slowPromise, (error: unknown) => {

    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.CANCELLED);
    return true;
  });

  virtualNow += 100;
  const cancelStarted = virtualNow;
  const snapshot = await coordinator.cancel();
  virtualNow += 50;

  assert.equal(snapshot.phase, "cancelled");
  assert.ok(snapshot.cancelledAt !== null);
  assert.ok(snapshot.cancelledAt - cancelStarted <= 2_000);

  await slowExpectation;

  assert.throws(
    () => coordinator.assertMayDispatch(),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      assert.equal(error.hints?.runState, "cancelled");
      return true;
    },
  );

  await assert.rejects(
    coordinator.dispatch("queuedWork", { n: 99 }, "inv-3"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.equal(coordinator.snapshot().applied.length, 1);
  assert.equal(coordinator.snapshot().applied[0]?.tool, "applyChange");
  assert.deepEqual(coordinator.snapshot().applied[0]?.output, { applied: "patch-a" });
});

test("[PER-02] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const registry = createTypedToolDispatchRegistry({
    validateEcho: (input: unknown) => {
      const payload = input as { value?: string };
      if (typeof payload?.value !== "string" || payload.value.length === 0) {
        throw invalidToolInputError("Entrada inválida para validateEcho.");
      }
      return { echoed: payload.value };
    },
  });
  const coordinator = new ToolRunCoordinator(registry);

  await assert.rejects(
    coordinator.dispatch("validateEcho", { value: "" }, "bad-1"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.equal(coordinator.snapshot().applied.length, 0);
  assert.equal(coordinator.snapshot().phase, "running");
});

test("[PER-02] dispatch isolado em worker thread responde com resultado tipado", async () => {
  const output = await dispatchInIsolatedWorker("echo", { ok: true }, ["echo"]);
  assert.deepEqual(output, { ok: true });
});
