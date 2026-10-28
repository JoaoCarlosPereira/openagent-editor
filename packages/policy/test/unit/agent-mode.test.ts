import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  AGENT_MODE_ASK_BLOCKED_MESSAGE,
  assertCapabilityAllowedForAgentMode,
  askAgentModeBlockedError,
  validatePolicyAgentMode,
} from "../../src/index.js";

test("[AGT-01] Ask bloqueia gravação de arquivo e comando mutável", () => {
  assert.throws(
    () => assertCapabilityAllowedForAgentMode("ask", "file.write"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
      assert.deepEqual(error.details, [AGENT_MODE_ASK_BLOCKED_MESSAGE]);
      return true;
    },
  );

  assert.throws(
    () => assertCapabilityAllowedForAgentMode("ask", "shell.exec"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "PERMISSION_DENIED");
      assert.equal(error.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
      return true;
    },
  );

  assert.doesNotThrow(() => assertCapabilityAllowedForAgentMode("ask", "file.read"));
  assert.doesNotThrow(() => assertCapabilityAllowedForAgentMode("ask", "file.search"));
  assert.doesNotThrow(() => assertCapabilityAllowedForAgentMode("agent", "file.write"));
  assert.doesNotThrow(() => assertCapabilityAllowedForAgentMode("plan", "shell.exec"));
});

test("[AGT-01] Caminho de erro: modo inválido retorna INVALID_STATE", () => {
  const invalid = validatePolicyAgentMode("chat");
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.code, "INVALID_STATE");
    assert.ok(invalid.errors.length > 0);
  }

  const blocked = askAgentModeBlockedError();
  assert.equal(blocked.code, "PERMISSION_DENIED");
  assert.equal(blocked.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
});
