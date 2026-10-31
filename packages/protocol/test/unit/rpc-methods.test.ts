import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_RPC_METHODS,
  ProtocolError,
  RPC_METHOD,
  RPC_METHOD_SPECS,
  RPC_PROTOCOL_VERSION,
  assertRpcRequest,
  getRpcMethodSpec,
  isRpcMethod,
  validateRpcRequest,
} from "../../src/index.js";

const WORKSPACE_ID = "ws-cli-parity-01";
const SESSION_ID = "ses-987fcdeb-51a2-43f7-9012-345678901234";
const RUN_ID = "run-456e7890-e12b-34c5-d678-901234567890";

function baseRpcEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    method: RPC_METHOD.SESSION_LIST,
    requestId: "req-cli-001",
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    expectedVersion: 0,
    capability: "session.read",
    payload: {},
    rpcVersion: RPC_PROTOCOL_VERSION,
    metadata: { client: "cli" },
    ...overrides,
  };
}

test("[CLI-01] Catálogo RPC cobre session, run, queue, permission, tool, checkpoint, agent, project, context e extension", () => {
  const expectedPrefixes = [
    "session.",
    "run.",
    "run.queue.",
    "permission.",
    "tool.",
    "checkpoint.",
    "agent.",
    "project.",
    "context.",
    "completion.",
    "extension.",
  ];

  for (const prefix of expectedPrefixes) {
    assert.ok(
      ALL_RPC_METHODS.some((method) => method.startsWith(prefix)),
      `prefixo ausente: ${prefix}`,
    );
  }

  assert.equal(ALL_RPC_METHODS.length, 32);
});

test("[CLI-01] session.list ancora workspaceId e expõe bindings de provedor, modo, regras, MCP e sessões", () => {
  const spec = getRpcMethodSpec(RPC_METHOD.SESSION_LIST);
  assert.deepEqual(spec.workspaceBindings, [
    "provider",
    "mode",
    "rules",
    "mcp",
    "sessions",
  ]);

  const result = validateRpcRequest(baseRpcEnvelope());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.workspaceId, WORKSPACE_ID);
    assert.deepEqual(result.workspaceBindings, spec.workspaceBindings);
    assert.equal(result.value.method, RPC_METHOD.SESSION_LIST);
    assert.equal(result.value.metadata?.client, "cli");
  }
});

test("[CLI-01] run.start valida UserInput e capability run.write no mesmo workspace", () => {
  const request = baseRpcEnvelope({
    method: RPC_METHOD.RUN_START,
    capability: "run.write",
    payload: {
      mode: "agent",
      input: { text: "Continuar do workspace local." },
    },
  });

  const result = validateRpcRequest(request);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.workspaceId, WORKSPACE_ID);
    const payload = result.value.payload as { mode?: string; input: { text?: string } };
    assert.equal(payload.mode, "agent");
    assert.equal(payload.input.text, "Continuar do workspace local.");
  }
});

test("[CLI-01] Caminho de erro: método desconhecido retorna INVALID_STATE sem mutar estado", () => {
  const before = baseRpcEnvelope({ method: "session.unknown" });
  const result = validateRpcRequest(before);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.code, "INVALID_STATE");
    assert.ok(result.errors.some((msg) => msg.includes("method")));
  }
  assert.equal(isRpcMethod("session.unknown"), false);
});

test("[CLI-01] Caminho de erro: capability incompatível e run.start sem input retornam INVALID_STATE", () => {
  const wrongCapability = validateRpcRequest(
    baseRpcEnvelope({
      method: RPC_METHOD.RUN_START,
      capability: "session.read",
      payload: { input: { text: "ok" } },
    }),
  );
  assert.equal(wrongCapability.valid, false);
  if (!wrongCapability.valid) {
    assert.equal(wrongCapability.code, "INVALID_STATE");
  }

  const missingInput = validateRpcRequest(
    baseRpcEnvelope({
      method: RPC_METHOD.RUN_START,
      capability: "run.write",
      payload: { mode: "plan" },
    }),
  );
  assert.equal(missingInput.valid, false);
  if (!missingInput.valid) {
    assert.equal(missingInput.code, "INVALID_STATE");
    assert.ok(missingInput.errors.some((msg) => msg.includes("input")));
  }

  assert.throws(
    () =>
      assertRpcRequest(
        baseRpcEnvelope({
          method: RPC_METHOD.RUN_QUEUE_ADD,
          capability: "run.queue",
          payload: { input: { text: "" } },
        }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, "INVALID_STATE");
      return true;
    },
  );
});

test("[CLI-01] Cada método do catálogo possui spec com capability estável", () => {
  for (const method of ALL_RPC_METHODS) {
    assert.equal(RPC_METHOD_SPECS[method].method, method);
    assert.ok(RPC_METHOD_SPECS[method].capability.length > 0);
    assert.ok(RPC_METHOD_SPECS[method].workspaceBindings.length > 0);
  }
});
