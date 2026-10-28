import test from "node:test";
import assert from "node:assert/strict";

import { ProtocolError } from "@openagent/protocol";

import {
  consumeOnceGrant,
  grantMatchesRequest,
  InMemoryGrantRegistry,
  isGrantExpired,
  issuePermissionGrant,
  issuePermissionGrantFromGate,
  validatePermissionGrantContext,
} from "../../src/grants.js";
import {
  createToolPermissionRequest,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
} from "../../src/index.js";

const baseContext = {
  nowMs: 1_700_000_000_000,
  sessionId: "sess-1",
  workspaceId: "ws-1",
  sessionExpiresAtMs: 1_700_000_000_000 + 60_000,
  workspaceGrantTtlMs: 120_000,
};

test("[PER-01] Grant once expira após consumo único", () => {
  const request = createToolPermissionRequest({
    requestId: "req-once",
    capability: "file.write",
    target: { kind: "path", path: "src/a.ts" },
    offeredScopes: ["once"],
  });
  const grant = issuePermissionGrant({
    grantId: "g-once",
    request,
    scope: "once",
    context: baseContext,
  });
  assert.equal(grant.expiresAtMs, baseContext.nowMs);
  assert.equal(isGrantExpired(grant, baseContext.nowMs), false);
  assert.equal(
    grantMatchesRequest(grant, "file.write", { kind: "path", path: "src/a.ts" }, baseContext),
    true,
  );

  const consumed = consumeOnceGrant(grant);
  assert.equal(consumed.consumed, true);
  assert.equal(isGrantExpired(consumed, baseContext.nowMs), true);
});

test("[PER-01] Grant session respeita expiração da sessão", () => {
  const request = createToolPermissionRequest({
    requestId: "req-session",
    capability: "shell.exec",
    target: { kind: "command", command: "npm test" },
  });
  const grant = issuePermissionGrant({
    grantId: "g-session",
    request,
    scope: "session",
    context: baseContext,
  });
  const sessionExpiresAtMs = baseContext.sessionExpiresAtMs ?? baseContext.nowMs;
  assert.equal(grant.expiresAtMs, sessionExpiresAtMs);
  assert.equal(isGrantExpired(grant, sessionExpiresAtMs + 1), true);
  assert.equal(
    grantMatchesRequest(grant, "shell.exec", { kind: "command", command: "npm test" }, {
      ...baseContext,
      sessionId: "other",
    }),
    false,
  );
});

test("[PER-01] Grant workspace usa TTL configurável", () => {
  const request = createToolPermissionRequest({
    requestId: "req-ws",
    capability: "tool.invoke",
    target: { kind: "tool", tool: "read", target: "README.md" },
  });
  const grant = issuePermissionGrant({
    grantId: "g-ws",
    request,
    scope: "workspace",
    context: baseContext,
  });
  const workspaceGrantTtlMs = baseContext.workspaceGrantTtlMs ?? 0;
  const expectedExpiry = baseContext.nowMs + workspaceGrantTtlMs;
  assert.equal(grant.expiresAtMs, expectedExpiry);
  assert.equal(
    grantMatchesRequest(grant, "tool.invoke", { kind: "tool", tool: "read", target: "README.md" }, {
      ...baseContext,
      sessionId: "sess-other",
    }),
    true,
  );
  assert.equal(isGrantExpired(grant, expectedExpiry + 1), true);
});

test("[PER-01] Emite grant a partir de gate resolvido com allow", () => {
  const request = createToolPermissionRequest({
    requestId: "req-gate",
    capability: "file.read",
    target: { kind: "path", path: "package.json" },
  });
  const resolvedGate = resolvePermissionExecutionGate(
    openPermissionExecutionGate(request, "session"),
    "allow",
    "session",
  );
  assert.equal(resolvedGate.phase, "resolved");
  const grant = issuePermissionGrantFromGate(resolvedGate, "g-from-gate", baseContext);
  assert.equal(grant.scope, "session");
  assert.equal(grant.targetPattern, "package.json");
});

test("[PER-01] Caminho de erro: contexto inválido e deny no gate", () => {
  assert.equal(validatePermissionGrantContext(null), false);
  assert.equal(validatePermissionGrantContext({ nowMs: 1, sessionId: "", workspaceId: "x" }), false);

  const request = createToolPermissionRequest({
    requestId: "req-deny",
    capability: "file.read",
    target: { kind: "path", path: "x.ts" },
  });
  const deniedGate = resolvePermissionExecutionGate(
    openPermissionExecutionGate(request),
    "deny",
    "once",
  );
  if (deniedGate.phase !== "resolved") {
    throw new Error("gate deveria estar resolvido");
  }
  assert.throws(
    () => issuePermissionGrantFromGate(deniedGate, "g-deny", baseContext),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, "INVALID_STATE");
      return true;
    },
  );

  const onceGrant = issuePermissionGrant({
    grantId: "g2",
    request,
    scope: "once",
    context: baseContext,
  });
  assert.throws(() => consumeOnceGrant({ ...onceGrant, scope: "session" }), ProtocolError);
});

test("[PER-01] Registry encontra grant ativo", () => {
  const registry = new InMemoryGrantRegistry();
  const request = createToolPermissionRequest({
    requestId: "req-reg",
    capability: "file.write",
    target: { kind: "path", path: "lib.ts" },
  });
  const grant = issuePermissionGrant({
    grantId: "g-reg",
    request,
    scope: "workspace",
    context: baseContext,
  });
  registry.register(grant);
  const found = registry.findActiveGrant(
    "file.write",
    { kind: "path", path: "lib.ts" },
    baseContext,
  );
  assert.equal(found?.grantId, "g-reg");
});
