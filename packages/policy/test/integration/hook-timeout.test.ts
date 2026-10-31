import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS,
  LocalHookEngine,
  assertLocalHooksAllowAction,
} from "../../src/index.js";

test("[CUS-03] timeout de hook não trava a sessão — ação segue após teto", async () => {
  const engine = new LocalHookEngine(
    [
      {
        id: "never-finishes",
        source: ".cursor/hooks/slow.ts",
        handler: () => new Promise(() => {}),
      },
    ],
    { handlerTimeoutMs: 40 },
  );

  const started = Date.now();
  await assertLocalHooksAllowAction(engine, {
    capability: "file.read",
    target: { kind: "path", path: "README.md" },
    sessionId: "sess-timeout",
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 400, `esperado <400ms, obteve ${elapsed}ms`);
});

test("[CUS-03] hook lento ignorado não impede negação rápida de outro hook", async () => {
  const engine = new LocalHookEngine(
    [
      {
        id: "slow-deny",
        source: "slow",
        handler: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ decision: "deny", justification: "tarde demais" }), 500);
          }),
      },
      {
        id: "fast-deny",
        source: ".cursor/hooks.json",
        handler: () => ({ decision: "deny", justification: "Bloqueado pelo hook rápido." }),
      },
    ],
    { handlerTimeoutMs: 50 },
  );

  await assert.rejects(
    () =>
      assertLocalHooksAllowAction(engine, {
        capability: "shell.exec",
        target: { kind: "command", command: "echo hi" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.message, "Bloqueado pelo hook rápido.");
      return true;
    },
  );
});

test("[CUS-03] caminho de erro: handlerTimeoutMs inválido retorna INVALID_STATE", () => {
  assert.throws(
    () => new LocalHookEngine([], { handlerTimeoutMs: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[CUS-03] timeout padrão alinhado a resposta rápida da sessão", () => {
  assert.equal(DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS, 2_000);
});
