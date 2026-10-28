import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  LocalHookEngine,
  assertLocalHooksAllowAction,
  formatHookDenialForDisplay,
  validateLocalHookAction,
} from "../../src/index.js";

test("[CUS-03] hook local nega ação e expõe justificativa para exibição", async () => {
  const engine = new LocalHookEngine([
    {
      id: "deny-shell",
      source: ".cursor/hooks.json",
      handler: (action) => {
        if (action.capability === "shell.exec") {
          return { decision: "deny", justification: "Comandos de shell bloqueados pela política interna." };
        }
        return { decision: "allow" };
      },
    },
  ]);

  await assert.rejects(
    () =>
      assertLocalHooksAllowAction(engine, {
        capability: "shell.exec",
        target: { kind: "command", command: "rm -rf /" },
        runId: "run-cus03",
        sessionId: "sess-cus03",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      assert.equal(error.message, "Comandos de shell bloqueados pela política interna.");
      return true;
    },
  );

  const evaluation = await engine.evaluate({
    capability: "shell.exec",
    target: { kind: "command", command: "echo ok" },
  });
  assert.equal(evaluation.decision, "deny");
  if (evaluation.decision !== "deny") {
    return;
  }
  const display = formatHookDenialForDisplay(evaluation);
  assert.equal(display.blocked, true);
  assert.equal(display.hookSource, ".cursor/hooks.json");
  assert.equal(display.message, display.justification);
  assert.ok(display.justification.includes("política interna"));
});

test("[CUS-03] hooks permitem ação quando nenhum handler nega", async () => {
  const engine = new LocalHookEngine([
    {
      id: "allow-all",
      source: "project/.openagent/hooks.local.ts",
      handler: () => ({ decision: "allow" }),
    },
  ]);

  await assertLocalHooksAllowAction(engine, {
    capability: "file.read",
    target: { kind: "path", path: "README.md" },
  });
});

test("[CUS-03] caminho de erro: contexto inválido retorna INVALID_STATE sem efeito colateral", () => {
  const engine = new LocalHookEngine();

  assert.throws(
    () => validateLocalHookAction({ capability: "", target: { kind: "path", path: "a.ts" } }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => validateLocalHookAction({ capability: "file.read", target: { kind: "path", path: "" } }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.doesNotThrow(() => {
    engine.register({
      id: "noop",
      source: "fixture",
      handler: () => ({ decision: "allow" }),
    });
  });
});
