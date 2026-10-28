import test from "node:test";
import assert from "node:assert/strict";
import {
  HARNESS_EVENT_SCHEMA_VERSION,
  ProtocolError,
  assertHarnessEvent,
  validateHarnessEvent,
  validateHarnessEventStream,
  type HarnessEvent,
} from "../../src/index.js";

const RUN_ID = "run-456e7890-e12b-34c5-d678-901234567890";

function baseEvent(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    sequence: 1,
    runId: RUN_ID,
    type: "session.resumed",
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef: "sha256:abc123session",
    timestamp: 1729000000000,
    ...overrides,
  };
}

test("[SES-01] stream de retomada valida sequence crescente e schemaVersion para reconstruir sessão", () => {
  const resumeStream = [
    baseEvent({
      sequence: 1,
      type: "session.resumed",
      payloadRef: "sha256:snapshot-mode-messages-tools",
    }),
    baseEvent({
      sequence: 2,
      type: "session.mode",
      payloadRef: "sha256:mode-agent",
    }),
    baseEvent({
      sequence: 3,
      type: "message.snapshot",
      payloadRef: "sha256:messages-retained",
    }),
    baseEvent({
      sequence: 4,
      type: "attachment.retained",
      payloadRef: "sha256:attachments-still-on-disk",
    }),
  ];

  const result = validateHarnessEventStream(resumeStream);
  assert.equal(result.valid, true);
  if (result.valid && result.events) {
    assert.equal(result.events.length, 4);
    assert.equal(result.events[0]?.type, "session.resumed");
    assert.equal(result.events[3]?.sequence, 4);
    assert.deepEqual(
      result.events.map((event) => event.schemaVersion),
      [1, 1, 1, 1],
    );
  }
});

test("[AGT-03] stream de execução Agent valida tool.result e diff.grouped em ordem", () => {
  const agentStream = [
    baseEvent({
      sequence: 1,
      type: "tool.result",
      payloadRef: "sha256:tool-edit-multi-file",
    }),
    baseEvent({
      sequence: 2,
      type: "tool.result",
      payloadRef: "sha256:tool-run-authorized-test",
    }),
    baseEvent({
      sequence: 3,
      type: "diff.grouped",
      payloadRef: "sha256:grouped-diff-all-files",
    }),
    baseEvent({
      sequence: 4,
      type: "tool.result",
      payloadRef: "sha256:tool-result-per-invocation",
    }),
  ];

  const result = validateHarnessEventStream(agentStream);
  assert.equal(result.valid, true);
  if (result.valid && result.events) {
    assert.deepEqual(result.events.map((event) => event.type), [
      "tool.result",
      "tool.result",
      "diff.grouped",
      "tool.result",
    ]);
    assert.equal(result.events.every((event) => event.runId === RUN_ID), true);
  }
});

test("[SES-01] entrada inválida retorna INVALID_STATE via validateHarnessEvent sem mutar objeto", () => {
  const invalid = {
    sequence: 0,
    runId: RUN_ID,
    type: "session.resumed",
    schemaVersion: 2,
    payloadRef: "sha256:bad",
    timestamp: 1729000000000,
  };
  const clone = structuredClone(invalid);

  const result = validateHarnessEvent(invalid);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.code, "INVALID_STATE");
    assert.ok(result.errors.some((msg) => msg.includes("sequence")));
    assert.ok(result.errors.some((msg) => msg.includes("schemaVersion")));
  }
  assert.deepEqual(invalid, clone);
});

test("[SES-01] assertHarnessEvent lança ProtocolError INVALID_STATE para evento inválido", () => {
  assert.throws(
    () => {
      assertHarnessEvent(null);
    },
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, "INVALID_STATE");
      assert.ok(err.details.length > 0);
      return true;
    },
  );
});

test("validateHarnessEventStream rejeita sequence duplicada ou fora de ordem", () => {
  const outOfOrder = [
    baseEvent({ sequence: 1 }),
    baseEvent({ sequence: 1, type: "message.snapshot" }),
  ];
  const result = validateHarnessEventStream(outOfOrder);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.code, "INVALID_STATE");
    assert.ok(result.errors[0]?.includes("sequence 1 deve ser maior que 1"));
  }
});
