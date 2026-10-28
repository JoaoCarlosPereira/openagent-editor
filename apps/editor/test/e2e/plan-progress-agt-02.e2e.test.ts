import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HARNESS_EVENT_SCHEMA_VERSION, ProtocolError } from "@openagent/protocol";

import {
  PLAN_ACCEPTED_EVENT,
  PLAN_PRESENTED_EVENT,
  PLAN_PROGRESS_EVENT,
  PlanProgressController,
} from "../../src/review/plan-progress.js";

const RUN_ID = "run-agt-02-plan-e2e";
const PLAN_ID = "plan-agt-02-1";

const STEPS = [
  { stepId: "step-1", label: "Analisar requisitos" },
  { stepId: "step-2", label: "Aplicar mudanças" },
];

function harnessEvent(sequence: number, type: string, payloadRef: string) {
  return {
    sequence,
    runId: RUN_ID,
    type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: 1_729_000_000_000 + sequence,
  };
}

describe("AGT-02 e2e — plano e progresso do modo Plan", () => {
  it("após aceite mostra o plano e o progresso visíveis durante a execução", () => {
    const panel = new PlanProgressController(RUN_ID);

    const presented = panel.push({
      event: harnessEvent(1, PLAN_PRESENTED_EVENT, "sha256:plan-presented"),
      payload: {
        type: PLAN_PRESENTED_EVENT,
        runId: RUN_ID,
        sessionId: "session-plan",
        planId: PLAN_ID,
        title: "Plano de correção",
        steps: STEPS,
      },
    });

    assert.match(presented.html, /data-testid="plan-progress-panel"/);
    assert.match(presented.html, /data-phase="presented"/);
    assert.match(presented.html, /data-testid="plan-title"/);
    assert.match(presented.html, /Plano de correção/);
    assert.equal(presented.accessible.steps.length, 2);
    assert.equal(presented.accessible.phase, "presented");
    assert.doesNotMatch(presented.html, /data-testid="plan-progress"/);

    const accepted = panel.push({
      event: harnessEvent(2, PLAN_ACCEPTED_EVENT, "sha256:plan-accepted"),
      payload: {
        type: PLAN_ACCEPTED_EVENT,
        runId: RUN_ID,
        sessionId: "session-plan",
        planId: PLAN_ID,
        title: "Plano de correção",
        steps: STEPS,
      },
    });

    assert.equal(accepted.accessible.phase, "accepted");
    assert.match(accepted.html, /data-phase="accepted"/);
    assert.match(accepted.html, /Plano aceito/);
    assert.match(accepted.html, /data-testid="plan-progress"/);
    assert.match(accepted.html, /0\/2/);

    const progress1 = panel.push({
      event: harnessEvent(3, PLAN_PROGRESS_EVENT, "sha256:plan-progress-1"),
      payload: {
        type: PLAN_PROGRESS_EVENT,
        runId: RUN_ID,
        planId: PLAN_ID,
        currentStepId: "step-1",
        currentStepLabel: "Analisar requisitos",
        completedStepIds: ["step-1"],
        completedCount: 1,
        totalSteps: 2,
        progressRatio: 0.5,
      },
    });

    assert.equal(progress1.accessible.phase, "executing");
    assert.equal(progress1.accessible.completedCount, 1);
    assert.equal(progress1.accessible.progressRatio, 0.5);
    assert.match(progress1.html, /data-phase="executing"/);
    assert.match(progress1.html, /1\/2/);
    assert.match(progress1.html, /50%/);
    assert.match(progress1.html, /data-status="done"/);
    assert.match(progress1.html, /Analisar requisitos/);

    const progress2 = panel.push({
      event: harnessEvent(4, PLAN_PROGRESS_EVENT, "sha256:plan-progress-2"),
      payload: {
        type: PLAN_PROGRESS_EVENT,
        runId: RUN_ID,
        planId: PLAN_ID,
        currentStepId: "step-2",
        currentStepLabel: "Aplicar mudanças",
        completedStepIds: ["step-1", "step-2"],
        completedCount: 2,
        totalSteps: 2,
        progressRatio: 1,
      },
    });

    assert.equal(progress2.accessible.phase, "completed");
    assert.equal(progress2.accessible.completedCount, 2);
    assert.match(progress2.html, /data-phase="completed"/);
    assert.match(progress2.html, /2\/2/);
    assert.match(progress2.html, /100%/);
    assert.match(progress2.html, /Aplicar mudanças/);
  });

  it("caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
    const panel = new PlanProgressController(RUN_ID);
    panel.push({
      event: harnessEvent(1, PLAN_PRESENTED_EVENT, "sha256:ok"),
      payload: {
        type: PLAN_PRESENTED_EVENT,
        runId: RUN_ID,
        planId: PLAN_ID,
        title: "Plano estável",
        steps: STEPS,
      },
    });
    const before = panel.snapshot.html;

    assert.throws(
      () =>
        panel.push({
          event: { sequence: 0, runId: RUN_ID, type: PLAN_ACCEPTED_EVENT },
          payload: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);

    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(2, PLAN_PROGRESS_EVENT, "sha256:too-soon"),
          payload: {
            type: PLAN_PROGRESS_EVENT,
            runId: RUN_ID,
            planId: PLAN_ID,
            currentStepId: "step-1",
            currentStepLabel: "Analisar requisitos",
            completedStepIds: ["step-1"],
            completedCount: 1,
            totalSteps: 2,
            progressRatio: 0.5,
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);
  });
});
