import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  createToolPermissionRequest,
  formatPermissionPromptForDisplay,
  mayExecuteAfterPermissionGate,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
  validatePolicyCapability,
  validatePolicyTarget,
  validateToolPermissionRequest,
} from "../../src/index.js";

test("[PER-01] Pedido válido expõe ação, alvo e escopo antes do aceite explícito", () => {
  const request = createToolPermissionRequest({
    requestId: "perm-req-001",
    capability: "file.write",
    target: { kind: "path", path: "src/app.ts" },
    offeredScopes: ["once", "session"],
  });

  const gate = openPermissionExecutionGate(request, "once");
  assert.equal(gate.phase, "pending");
  assert.equal(mayExecuteAfterPermissionGate(gate), false);

  const display = formatPermissionPromptForDisplay(gate.prompt);
  assert.equal(display.action, "Gravar arquivo");
  assert.equal(display.target, "src/app.ts");
  assert.equal(display.scopeLabel, "Uma vez");

  const resolved = resolvePermissionExecutionGate(gate, "allow", "once");
  assert.equal(resolved.phase, "resolved");
  assert.equal(mayExecuteAfterPermissionGate(resolved), true);
});

test("[PER-01] Negação explícita impede execução sem efeito colateral no gate", () => {
  const request = createToolPermissionRequest({
    requestId: "perm-req-deny",
    capability: "shell.exec",
    target: { kind: "command", command: "npm test" },
  });
  const gate = openPermissionExecutionGate(request, "session");
  const denied = resolvePermissionExecutionGate(gate, "deny", "session");
  assert.equal(mayExecuteAfterPermissionGate(denied), false);
  assert.equal(denied.prompt.action, "Executar comando");
});

test("[PER-01] Caminho de erro: entrada inválida retorna INVALID_STATE", () => {
  const capability = validatePolicyCapability("");
  assert.equal(capability.valid, false);
  if (!capability.valid) {
    assert.equal(capability.code, "INVALID_STATE");
  }

  const target = validatePolicyTarget({ kind: "path" });
  assert.equal(target.valid, false);

  const request = validateToolPermissionRequest({
    requestId: "x",
    capability: "INVALID CAP",
    target: { kind: "unknown" },
  });
  assert.equal(request.valid, false);
  if (!request.valid) {
    assert.equal(request.code, "INVALID_STATE");
    assert.ok(request.errors.length > 0);
  }

  assert.throws(
    () =>
      createToolPermissionRequest({
        requestId: "",
        capability: "file.write",
        target: { kind: "path", path: "ok.ts" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
});

test("[PER-01] Segunda decisão sobre gate resolvido lança INVALID_STATE", () => {
  const request = createToolPermissionRequest({
    requestId: "perm-req-twice",
    capability: "tool.invoke",
    target: { kind: "tool", tool: "read_file", target: "README.md" },
  });
  const gate = openPermissionExecutionGate(request);
  const resolved = resolvePermissionExecutionGate(gate, "allow", "workspace");
  assert.throws(
    () => resolvePermissionExecutionGate(resolved, "allow", "workspace"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );
});
