import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  formatStandardLogToolAction,
  redactForStandardLog,
  STANDARD_LOG_REDACTED,
  validateStandardLogToolActionInput,
} from "../../src/redaction.js";

test("[PRV-02] Redaction omite credencial, conteúdo excluído e corpo bruto do modelo", () => {
  const credential = "must-not-appear-in-log";
  const log = formatStandardLogToolAction({
    tool: "file.read",
    target: "src/index.ts",
    credential,
    excludedFileContent: "conteudo-excluido",
    rawModelResponseBody: '{"choices":[{"message":{"content":"segredo bruto"}}]}',
  });

  const serialized = JSON.stringify(log);
  assert.equal(log.kind, "tool_action");
  assert.equal(log.credential, STANDARD_LOG_REDACTED);
  assert.equal(log.excludedFileContent, STANDARD_LOG_REDACTED);
  assert.equal(log.rawModelResponseBody, STANDARD_LOG_REDACTED);
  assert.equal(log.tool, "file.read");
  assert.equal(log.target, "src/index.ts");
  assert.ok(!serialized.includes(credential));
  assert.ok(!serialized.includes("conteudo-excluido"));
  assert.ok(!serialized.includes("segredo bruto"));
});

test("[PRV-02] redactForStandardLog redige chaves sensíveis aninhadas", () => {
  const redacted = redactForStandardLog({
    meta: {
      token: "nested-secret",
      label: "ok",
    },
    api_key: "top-level",
  });
  assert.deepEqual(redacted, {
    meta: {
      token: STANDARD_LOG_REDACTED,
      label: "ok",
    },
    api_key: STANDARD_LOG_REDACTED,
  });
});

test("[PRV-02] entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const invalid = validateStandardLogToolActionInput({ tool: "  " });
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.code, "INVALID_STATE");
  }

  assert.throws(
    () => formatStandardLogToolAction({ tool: "" } as never),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
});
