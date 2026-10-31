import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  RunToolPermissionFlow,
  assertRunToolMayExecute,
} from "@openagent/policy";

import {
  describeSandboxCapability,
  prepareSandboxToolDispatch,
  sandboxDegradationNoticeForPermission,
} from "../../src/index.js";

const degradedMacProbe = () => ({
  nativeAvailable: false,
  primitive: null,
  sandboxExecAvailable: false,
  seatbeltOperational: false,
});

test("[PER-01] sandbox macOS nativa ou degradada expõe aviso antes do pedido de permissão", () => {
  const sandboxOptions = { platform: "darwin" as const, macosProbe: degradedMacProbe };
  const degradedSnapshot = describeSandboxCapability(sandboxOptions);

  assert.equal(degradedSnapshot.platform, "darwin");
  assert.equal(degradedSnapshot.level, "degraded");
  const notice = sandboxDegradationNoticeForPermission(degradedSnapshot);
  assert.ok(notice && notice.length > 0);

  const flow = new RunToolPermissionFlow();
  const prepared = prepareSandboxToolDispatch(
    flow,
    {
      runId: "run-sandbox-61",
      sessionId: "sess-sandbox-61",
      executionMode: "standard",
      capability: "file.read",
      target: { kind: "path", path: "src/index.ts" },
      requestId: "perm-sandbox-61",
    },
    sandboxOptions,
  );

  assert.equal(prepared.sandbox.level, "degraded");
  assert.ok(sandboxDegradationNoticeForPermission(prepared.sandbox));

  assert.equal(prepared.permission.phase, "pending");
  const pendingPermission = prepared.permission;
  if (pendingPermission.phase !== "pending") {
    return;
  }

  assert.equal(pendingPermission.prompt.action, "Ler arquivo");
  assert.equal(pendingPermission.prompt.target, "src/index.ts");
  assert.ok(pendingPermission.prompt.scopeLabel.length > 0);
  assert.equal(pendingPermission.prompt.sandboxIsolationLevel, "degraded");
  assert.equal(
    pendingPermission.prompt.degradationNotice,
    sandboxDegradationNoticeForPermission(prepared.sandbox),
  );
  assert.equal(pendingPermission.canExecute, false);

  assert.throws(() => assertRunToolMayExecute(pendingPermission.gate), (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
    return true;
  });

  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assert.equal(allowed.canExecute, true);
  assertRunToolMayExecute(allowed.gate);
});

test("[PER-03] Somente leitura bloqueia ferramenta mutável antes do dispatch sandbox macOS", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareSandboxToolDispatch(
        flow,
        {
          runId: "run-ro-61",
          sessionId: "sess-ro-61",
          executionMode: "read_only",
          capability: "file.write",
          target: { kind: "path", path: "out.txt" },
          requestId: "perm-ro-61",
        },
        { platform: "darwin", macosProbe: degradedMacProbe },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      assert.ok(
        error.message.includes(EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE) ||
          error.details.some((detail) => detail.includes(EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE)),
      );
      return true;
    },
  );
});

test("[PER-01] entrada inválida de permissão macOS retorna INVALID_STATE sem efeito colateral", () => {
  const flow = new RunToolPermissionFlow();
  assert.throws(
    () =>
      prepareSandboxToolDispatch(
        flow,
        {
          runId: "run-invalid-61",
          sessionId: "sess-invalid-61",
          executionMode: "standard",
          capability: "not-a-valid-capability",
          target: { kind: "path", path: "x" },
          requestId: "perm-invalid-61",
        },
        { platform: "darwin", macosProbe: degradedMacProbe },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(flow.getPending("perm-invalid-61"), undefined);
});

test("describeSandboxCapability reporta native no macOS quando sandbox-exec está operacional", () => {
  const snapshot = describeSandboxCapability({
    platform: "darwin",
    macosProbe: () => ({
      nativeAvailable: true,
      primitive: "sandbox-exec",
      sandboxExecAvailable: true,
      seatbeltOperational: true,
    }),
  });
  assert.equal(snapshot.level, "native");
  assert.equal(snapshot.nativePrimitive, "sandbox-exec");
  assert.equal(snapshot.degradationNotice, undefined);
});
