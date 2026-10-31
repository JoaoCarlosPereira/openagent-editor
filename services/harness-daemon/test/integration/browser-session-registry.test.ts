import assert from "node:assert/strict";
import test from "node:test";

import { ProtocolError } from "@openagent/protocol";

import { BrowserSessionRegistry, type BrowserSessionRecord } from "../../src/runs/browser-session-registry.js";

function fakeRecord(runId: string): { record: BrowserSessionRecord; terminated: () => boolean; closed: () => boolean } {
  let terminated = false;
  let closed = false;
  const record: BrowserSessionRecord = {
    runId,
    sessionId: "session-1",
    targetId: "",
    lastUrl: "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: { close: async () => { closed = true; } } as any,
    worker: { transport: undefined as never, sandbox: { level: "native", platform: "linux" }, terminate: async () => { terminated = true; } },
  };
  return { record, terminated: () => terminated, closed: () => closed };
}

test("BrowserSessionRegistry.register rejeita registro duplicado em vez de sobrescrever silenciosamente", () => {
  const registry = new BrowserSessionRegistry();
  const first = fakeRecord("run-dup-1");
  registry.register(first.record);
  const second = fakeRecord("run-dup-1");
  assert.throws(() => registry.register(second.record), (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, "INVALID_STATE");
    return true;
  });
  // A primeira sessão continua acessível e não foi substituída silenciosamente pela segunda.
  assert.equal(registry.get("run-dup-1"), first.record);
});

test("BrowserSessionRegistry.closeForRun é idempotente e libera worker/sessão uma única vez", async () => {
  const registry = new BrowserSessionRegistry();
  const entry = fakeRecord("run-close-1");
  registry.register(entry.record);
  assert.equal(await registry.closeForRun("run-close-1"), true);
  assert.equal(entry.terminated(), true);
  assert.equal(entry.closed(), true);
  assert.equal(registry.get("run-close-1"), undefined);
  // Segunda chamada não encontra sessão: retorna false sem erro (não tenta encerrar de novo).
  assert.equal(await registry.closeForRun("run-close-1"), false);
});

test("BrowserSessionRegistry.updateTarget atualiza targetId/lastUrl de uma sessão registrada", () => {
  const registry = new BrowserSessionRegistry();
  const entry = fakeRecord("run-update-1");
  registry.register(entry.record);
  registry.updateTarget("run-update-1", "target-abc", "https://example.test/");
  const record = registry.get("run-update-1");
  assert.ok(record);
  assert.equal(record.targetId, "target-abc");
  assert.equal(record.lastUrl, "https://example.test/");
});

test("BrowserSessionRegistry.updateTarget em runId inexistente não lança", () => {
  const registry = new BrowserSessionRegistry();
  assert.doesNotThrow(() => registry.updateTarget("run-missing", "target-x", "https://example.test/"));
});
