import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  RUN_PERMISSION_REQUESTED_EVENT,
  RunToolPermissionFlow,
  assertRunToolMayExecute,
  buildPermissionRequestedPayload,
} from "@openagent/policy";

import { prepareSandboxToolDispatch } from "../../src/index.js";

const degradedLinuxProbe = () => ({
  nativeAvailable: false,
  primitive: null,
  unshareUserNsAvailable: false,
});

test("[PER-01] Modo degradado informado no pedido de permissão antes do aceite", () => {
  const flow = new RunToolPermissionFlow();
  const prepared = prepareSandboxToolDispatch(
    flow,
    {
      runId: "run-degraded-63",
      sessionId: "sess-degraded-63",
      executionMode: "standard",
      capability: "file.read",
      target: { kind: "path", path: "packages/tools/src/index.ts" },
      requestId: "perm-degraded-63",
    },
    { linuxProbe: degradedLinuxProbe },
  );

  assert.equal(prepared.sandbox.level, "degraded");
  const pendingPermission = prepared.permission;
  assert.equal(pendingPermission.phase, "pending");
  if (pendingPermission.phase !== "pending") {
    return;
  }

  assert.equal(pendingPermission.prompt.sandboxIsolationLevel, "degraded");
  assert.ok(pendingPermission.prompt.degradationNotice);
  assert.equal(
    pendingPermission.prompt.degradationNotice,
    prepared.sandbox.degradationNotice,
  );
  assert.equal(pendingPermission.prompt.action, "Ler arquivo");
  assert.equal(pendingPermission.prompt.target, "packages/tools/src/index.ts");
  assert.ok(pendingPermission.prompt.scopeLabel.length > 0);
  assert.equal(pendingPermission.canExecute, false);

  const eventPayload = buildPermissionRequestedPayload(
    { runId: "run-degraded-63", sessionId: "sess-degraded-63" },
    pendingPermission.request,
    pendingPermission.gate,
  );
  assert.equal(eventPayload.type, RUN_PERMISSION_REQUESTED_EVENT);
  assert.equal(eventPayload.prompt.sandboxIsolationLevel, "degraded");
  assert.ok(eventPayload.prompt.degradationNotice);

  assert.throws(() => assertRunToolMayExecute(pendingPermission.gate), (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
    return true;
  });

  const allowed = flow.decide(pendingPermission.request.requestId, "allow", "once");
  assert.equal(allowed.canExecute, true);
  assert.equal(allowed.gate.prompt.sandboxIsolationLevel, "degraded");
  assert.ok(allowed.gate.prompt.degradationNotice);
  assertRunToolMayExecute(allowed.gate);
});

test("[PER-01] Pedido nativo não inclui aviso de degradação", () => {
  const flow = new RunToolPermissionFlow();
  const prepared = prepareSandboxToolDispatch(flow, {
    runId: "run-native-63",
    sessionId: "sess-native-63",
    executionMode: "standard",
    capability: "file.read",
    target: { kind: "path", path: "README.md" },
    requestId: "perm-native-63",
  }, {
    linuxProbe: () => ({
      nativeAvailable: true,
      primitive: "bubblewrap",
      unshareUserNsAvailable: true,
    }),
    platform: "linux",
  });

  assert.equal(prepared.sandbox.level, "native");
  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(prepared.permission.prompt.sandboxIsolationLevel, undefined);
  assert.equal(prepared.permission.prompt.degradationNotice, undefined);
});

test("[PER-01] entrada inválida retorna INVALID_STATE sem pedido pendente", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareSandboxToolDispatch(flow, {
        runId: "run-invalid-63",
        sessionId: "sess-invalid-63",
        executionMode: "standard",
        capability: "invalid-cap",
        target: { kind: "path", path: "x" },
        requestId: "perm-invalid-63",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(flow.getPending("perm-invalid-63"), undefined);
});
