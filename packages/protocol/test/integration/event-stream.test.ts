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

function resumePlanStep(index: number): { type: string; payloadRef: string } {
  const step = SESSION_RESUME_PLAN[index];
  assert.ok(step, `SESSION_RESUME_PLAN[${index}] ausente`);
  return step;
}

function pushWithBackpressure(
  controller: HarnessEventStreamController,
  event: HarnessEvent,
): void {
  let pushed = controller.push(event);
  while (
    !pushed.accepted &&
    pushed.code === PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM &&
    pushed.backpressure
  ) {
    controller.tryShift();
    pushed = controller.push(event);
  }
  assert.equal(pushed.accepted, true);
}

test("[SES-01] ordenação, backpressure e snapshot permitem retomar sessão após restart simulado", async () => {
  const controller = new HarnessEventStreamController({
    runId: RUN_ID,
    maxBufferedEvents: 2,
  });

  const firstStep = resumePlanStep(0);
  const secondStep = resumePlanStep(1);
  pushWithBackpressure(
    controller,
    sessionEvent(1, firstStep.type, firstStep.payloadRef),
  );
  pushWithBackpressure(
    controller,
    sessionEvent(2, secondStep.type, secondStep.payloadRef),
  );
  controller.tryShift();

  const snapshot = controller.snapshot();
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.nextSequence, 3);

  const afterRestart = restoreHarnessEventStreamFromSnapshot(
    snapshot,
    SESSION_RESUME_PLAN.length,
  );
  const consumeAfterRestart = (async () => {
    const consumed: HarnessEvent[] = [];
    for await (const event of afterRestart.consume()) {
      consumed.push(event);
    }
    return consumed;
  })();

  for (let index = 2; index < SESSION_RESUME_PLAN.length; index += 1) {
    const step = resumePlanStep(index);
    pushWithBackpressure(
      afterRestart,
      sessionEvent(index + 1, step.type, step.payloadRef),
    );
  }
  afterRestart.close();
  const consumedAfterRestart = await consumeAfterRestart;
  assert.deepEqual(
    consumedAfterRestart.map((event) => event.type),
    ["message.snapshot", "tool.registry", "attachment.retained"],
  );

  const validation = validateHarnessEventStream(afterRestart.snapshot().events);
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
  assert.equal(controller.isBackpressured, false);
});

test("[SES-01] entrada inválida retorna INVALID_STATE sem alterar buffer", () => {
  const controller = new HarnessEventStreamController({ runId: RUN_ID, maxBufferedEvents: 4 });
  const first = controller.push(
    sessionEvent(1, "session.resumed", "sha256:ok"),
  );
  assert.equal(first.accepted, true);
  assert.equal(controller.bufferedCount, 1);

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

  assert.equal(controller.bufferedCount, 1);
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
