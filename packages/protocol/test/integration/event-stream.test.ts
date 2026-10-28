import test from "node:test";
import assert from "node:assert/strict";
import {
  HARNESS_EVENT_SCHEMA_VERSION,
  HarnessEventStreamController,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  incompleteStreamError,
  restoreHarnessEventStreamFromSnapshot,
  validateHarnessEventStream,
  type HarnessEvent,
} from "../../src/index.js";

const RUN_ID = "run-ses01-restart-001";

function sessionEvent(
  sequence: number,
  type: string,
  payloadRef: string,
): HarnessEvent {
  return {
    sequence,
    runId: RUN_ID,
    type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: 1_729_000_000_000 + sequence,
  };
}

const SESSION_RESUME_PLAN: Array<{ type: string; payloadRef: string }> = [
  { type: "session.resumed", payloadRef: "sha256:snapshot-mode-messages-tools" },
  { type: "session.mode", payloadRef: "sha256:mode-agent" },
  { type: "message.snapshot", payloadRef: "sha256:messages-retained" },
  { type: "tool.registry", payloadRef: "sha256:tools-still-available" },
  { type: "attachment.retained", payloadRef: "sha256:attachments-still-on-disk" },
];

test("[SES-01] ordenação, backpressure e snapshot permitem retomar sessão após restart simulado", async () => {
  const controller = new HarnessEventStreamController({
    runId: RUN_ID,
    maxBufferedEvents: 2,
  });

  const consumedBeforeRestart: HarnessEvent[] = [];
  let sequence = 1;

  for (const step of SESSION_RESUME_PLAN.slice(0, 2)) {
    let pushed = controller.push(sessionEvent(sequence, step.type, step.payloadRef));
    while (!pushed.accepted && pushed.code === PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM && pushed.backpressure) {
      const drained = controller.tryShift();
      if (drained) {
        consumedBeforeRestart.push(drained);
      }
      pushed = controller.push(sessionEvent(sequence, step.type, step.payloadRef));
    }
    assert.equal(pushed.accepted, true);
    sequence += 1;
  }

  const drainedSecond = controller.tryShift();
  if (drainedSecond) {
    consumedBeforeRestart.push(drainedSecond);
  }

  const snapshot = controller.snapshot();
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.nextSequence, 3);

  const afterRestart = restoreHarnessEventStreamFromSnapshot(snapshot, 2);
  const consumedAfterRestart: HarnessEvent[] = [];

  for (const step of SESSION_RESUME_PLAN.slice(2)) {
    const pushed = afterRestart.push(sessionEvent(sequence, step.type, step.payloadRef));
    assert.equal(pushed.accepted, true);
    sequence += 1;
  }
  afterRestart.close();

  for await (const event of afterRestart.consume()) {
    consumedAfterRestart.push(event);
  }

  const fullStream = [...consumedBeforeRestart, ...consumedAfterRestart];
  const validation = validateHarnessEventStream(fullStream);
  assert.equal(validation.valid, true);
  if (!validation.valid || !validation.events) {
    return;
  }

  assert.deepEqual(validation.events.map((event) => event.type), [
    "session.resumed",
    "session.mode",
    "message.snapshot",
    "tool.registry",
    "attachment.retained",
  ]);
  assert.equal(validation.events.every((event) => event.runId === RUN_ID), true);
});

test("[SES-01] entrada inválida retorna INVALID_STATE sem alterar buffer", () => {
  const controller = new HarnessEventStreamController({ runId: RUN_ID, maxBufferedEvents: 4 });
  const first = controller.push(
    sessionEvent(1, "session.resumed", "sha256:ok"),
  );
  assert.equal(first.accepted, true);

  const invalid = controller.push({
    sequence: 3,
    runId: RUN_ID,
    type: "session.mode",
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef: "sha256:skip-sequence-2",
    timestamp: 1,
  });
  assert.equal(invalid.accepted, false);
  if (invalid.accepted) {
    return;
  }
  assert.equal(invalid.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.ok(invalid.errors.some((msg) => msg.includes("sequence 3 deve ser exatamente 2")));

  assert.equal(controller.bufferedCount, 0);
  assert.equal(controller.tryShift()?.sequence, 1);
});

test("[SES-01] stream interrompido antes de fechar lança INCOMPLETE_STREAM", () => {
  const controller = new HarnessEventStreamController({ runId: RUN_ID });
  assert.throws(() => controller.assertComplete(), (err: unknown) => {
    assert.ok(err instanceof ProtocolError);
    assert.equal(err.code, PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM);
    assert.equal(err.message, incompleteStreamError().message);
    return true;
  });
});
