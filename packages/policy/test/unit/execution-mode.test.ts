import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  assertCapabilityAllowedForExecutionMode,
  EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  isMutatingPolicyCapability,
  readOnlyExecutionModeBlockedError,
  validateExecutionMode,
} from "../../src/index.js";

test("[PER-03] Somente leitura bloqueia gravação de arquivo e comando mutável", () => {
  assert.throws(
    () => assertCapabilityAllowedForExecutionMode("read_only", "file.write"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
      assert.deepEqual(error.details, [EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE]);
      return true;
    },
  );

  assert.throws(
    () => assertCapabilityAllowedForExecutionMode("read_only", "shell.exec"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
      return true;
    },
  );

  assert.doesNotThrow(() =>
    assertCapabilityAllowedForExecutionMode("read_only", "file.read"),
  );
  assert.doesNotThrow(() =>
    assertCapabilityAllowedForExecutionMode("read_only", "file.search"),
  );
  assert.doesNotThrow(() =>
    assertCapabilityAllowedForExecutionMode("standard", "file.write"),
  );
});

test("[PER-03] Capabilities mutáveis conhecidas são classificadas para bloqueio", () => {
  assert.equal(isMutatingPolicyCapability("file.write"), true);
  assert.equal(isMutatingPolicyCapability("shell.exec"), true);
  assert.equal(isMutatingPolicyCapability("run.queue"), true);
  assert.equal(isMutatingPolicyCapability("file.read"), false);
  assert.equal(isMutatingPolicyCapability("file.search"), false);
});

test("[PER-03] Caminho de erro: modo de execução inválido retorna INVALID_STATE", () => {
  const invalid = validateExecutionMode("somente-leitura");
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.code, "INVALID_STATE");
    assert.ok(invalid.errors.length > 0);
  }

  const blocked = readOnlyExecutionModeBlockedError();
  assert.equal(blocked.code, "PERMISSION_DENIED");
  assert.equal(blocked.message, EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE);
});
