import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { parseDebugSession } from "../../src/agent/debug-mode-input.js";

test("[AGT-04] parseDebugSession aceita envelope válido", () => {
  const parsed = parseDebugSession({
    hypothesis: "Falha vem de import circular",
    evidence: {
      turns: [
        {
          toolCalls: [
            {
              invocationId: "inv-read",
              tool: "file.read",
              permissionRequestId: "perm-read",
              relativePath: "src/a.ts",
            },
          ],
        },
      ],
    },
    verification: {
      outcome: "confirmed",
      summary: "Import circular confirmado no grafo.",
    },
  });
  assert.equal(parsed.hypothesis, "Falha vem de import circular");
  assert.equal(parsed.verification.outcome, "confirmed");
});

test("[AGT-04] parseDebugSession rejeita verification inválida com INVALID_STATE", () => {
  assert.throws(
    () =>
      parseDebugSession({
        hypothesis: "H",
        evidence: { turns: [{ toolCalls: [{ invocationId: "i", tool: "file.read", permissionRequestId: "p", relativePath: "x" }] }] },
        verification: { outcome: "maybe", summary: "x" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
