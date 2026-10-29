import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETION_CANCEL_DEADLINE_MS,
  COMPLETION_EVENT_TYPE,
  RPC_METHOD,
  getRpcMethodSpec,
  isCompletionEventType,
  validateCompletionEventPayload,
  validateRpcRequest,
  RPC_PROTOCOL_VERSION,
} from "../../src/index.js";

test("prazo de cancelamento observável é 2 s", () => {
  assert.equal(COMPLETION_CANCEL_DEADLINE_MS, 2000);
});

test("catálogo de eventos de completion reconhece apenas tipos completion.*", () => {
  assert.equal(isCompletionEventType("completion.delta"), true);
  assert.equal(isCompletionEventType("run.started"), false);
});

test("payloads válidos e inválidos por tipo", () => {
  assert.equal(
    validateCompletionEventPayload({
      type: COMPLETION_EVENT_TYPE.DELTA,
      completionId: "c",
      attempt: 1,
      offset: 0,
      deltaText: "x",
    }).valid,
    true,
  );
  const invalid = validateCompletionEventPayload({
    type: COMPLETION_EVENT_TYPE.DELTA,
    completionId: "",
    attempt: 0,
    offset: -1,
    deltaText: "",
  });
  assert.equal(invalid.valid, false);
  assert.equal(validateCompletionEventPayload("x").valid, false);
  assert.equal(
    validateCompletionEventPayload({
      type: COMPLETION_EVENT_TYPE.STARTED,
      completionId: "c",
      attempt: 1,
      kind: "line",
      resumeOffset: 0,
    }).valid,
    false,
    "started sem inputHash é inválido",
  );
});

test("completion.start/cancel validam parâmetros no envelope RPC", () => {
  const base = {
    requestId: "r1",
    workspaceId: "ws-1",
    sessionId: "s1",
    runId: "run1",
    expectedVersion: 0,
    rpcVersion: RPC_PROTOCOL_VERSION,
  };
  const ok = validateRpcRequest({
    ...base,
    method: RPC_METHOD.COMPLETION_START,
    capability: getRpcMethodSpec(RPC_METHOD.COMPLETION_START).capability,
    payload: { completionId: "c", prefix: "a" },
  });
  assert.equal(ok.valid, true);
  const bad = validateRpcRequest({
    ...base,
    method: RPC_METHOD.COMPLETION_START,
    capability: getRpcMethodSpec(RPC_METHOD.COMPLETION_START).capability,
    payload: { completionId: "", prefix: 1, kind: "word" },
  });
  assert.equal(bad.valid, false);
  const cancelBad = validateRpcRequest({
    ...base,
    method: RPC_METHOD.COMPLETION_CANCEL,
    capability: getRpcMethodSpec(RPC_METHOD.COMPLETION_CANCEL).capability,
    payload: {},
  });
  assert.equal(cancelBad.valid, false);
});
