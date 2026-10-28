import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HARNESS_EVENT_SCHEMA_VERSION, ProtocolError } from "@openagent/protocol";

import {
  DEBUG_EVIDENCE_EVENT,
  DEBUG_HYPOTHESIS_EVENT,
  DEBUG_VERIFICATION_EVENT,
  DebugEvidenceController,
} from "../../src/review/debug-evidence.js";

const RUN_ID = "run-agt-04-debug-e2e";
const HYPOTHESIS = "O crash ocorre por timeout no cold start do worker";
const INVOCATION_IDS = ["inv-read-1", "inv-search-1"];

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

describe("AGT-04 e2e — hipótese e evidência do modo Debug", () => {
  it("registra hipótese, evidência e verificação antes de liberar conclusão", () => {
    const panel = new DebugEvidenceController(RUN_ID);

    assert.equal(panel.snapshot.accessible.canMarkCompleted, false);
    assert.match(panel.snapshot.html, /data-testid="debug-blocked-complete"/);

    const hypothesis = panel.push({
      event: harnessEvent(1, DEBUG_HYPOTHESIS_EVENT, "sha256:debug-hypothesis"),
      payload: {
        type: DEBUG_HYPOTHESIS_EVENT,
        runId: RUN_ID,
        sessionId: "session-debug",
        hypothesis: HYPOTHESIS,
      },
    });

    assert.match(hypothesis.html, /data-testid="debug-evidence-panel"/);
    assert.match(hypothesis.html, /data-phase="hypothesis"/);
    assert.match(hypothesis.html, /data-testid="debug-hypothesis"/);
    assert.match(hypothesis.html, /timeout no cold start/);
    assert.equal(hypothesis.accessible.phase, "hypothesis");
    assert.equal(hypothesis.accessible.canMarkCompleted, false);
    assert.doesNotMatch(hypothesis.html, /data-testid="debug-evidence"/);
    assert.doesNotMatch(hypothesis.html, /data-testid="debug-verification"/);

    const evidence = panel.push({
      event: harnessEvent(2, DEBUG_EVIDENCE_EVENT, "sha256:debug-evidence"),
      payload: {
        type: DEBUG_EVIDENCE_EVENT,
        runId: RUN_ID,
        sessionId: "session-debug",
        invocationIds: INVOCATION_IDS,
        toolResultCount: 2,
      },
    });

    assert.equal(evidence.accessible.phase, "evidence");
    assert.equal(evidence.accessible.toolResultCount, 2);
    assert.deepEqual([...evidence.accessible.invocationIds], INVOCATION_IDS);
    assert.equal(evidence.accessible.canMarkCompleted, false);
    assert.match(evidence.html, /data-phase="evidence"/);
    assert.match(evidence.html, /data-testid="debug-evidence"/);
    assert.match(evidence.html, /data-testid="debug-evidence-count"/);
    assert.match(evidence.html, />2</);
    assert.match(evidence.html, /inv-read-1/);
    assert.match(evidence.html, /inv-search-1/);
    assert.doesNotMatch(evidence.html, /data-testid="debug-verification"/);

    const verified = panel.push({
      event: harnessEvent(3, DEBUG_VERIFICATION_EVENT, "sha256:debug-verification"),
      payload: {
        type: DEBUG_VERIFICATION_EVENT,
        runId: RUN_ID,
        sessionId: "session-debug",
        outcome: "confirmed",
        summary: "Logs confirmam ENOENT no descendant.pid antes do timeoutMs 2000.",
      },
    });

    assert.equal(verified.accessible.phase, "verified");
    assert.equal(verified.accessible.verificationOutcome, "confirmed");
    assert.equal(verified.accessible.canMarkCompleted, true);
    assert.match(verified.html, /data-phase="verified"/);
    assert.match(verified.html, /data-testid="debug-verification"/);
    assert.match(verified.html, /data-outcome="confirmed"/);
    assert.match(verified.html, /Confirmada/);
    assert.match(verified.html, /descendant\.pid/);
    assert.match(verified.html, /data-testid="debug-can-complete"/);
    assert.doesNotMatch(verified.html, /data-testid="debug-blocked-complete"/);
  });

  it("caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
    const panel = new DebugEvidenceController(RUN_ID);
    panel.push({
      event: harnessEvent(1, DEBUG_HYPOTHESIS_EVENT, "sha256:ok"),
      payload: {
        type: DEBUG_HYPOTHESIS_EVENT,
        runId: RUN_ID,
        hypothesis: HYPOTHESIS,
      },
    });
    const before = panel.snapshot.html;

    assert.throws(
      () =>
        panel.push({
          event: { sequence: 0, runId: RUN_ID, type: DEBUG_EVIDENCE_EVENT },
          payload: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);

    // Evidência prematura (fase hypothesis ok, mas verification sem evidence) — tenta verification.
    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(2, DEBUG_VERIFICATION_EVENT, "sha256:too-soon"),
          payload: {
            type: DEBUG_VERIFICATION_EVENT,
            runId: RUN_ID,
            outcome: "confirmed",
            summary: "não deveria aceitar",
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);
    assert.equal(panel.snapshot.accessible.phase, "hypothesis");
    assert.equal(panel.snapshot.accessible.canMarkCompleted, false);

    // Recovery: verification prematura não consome sequence — evidence legítima com seq=2 funciona.
    const evidence = panel.push({
      event: harnessEvent(2, DEBUG_EVIDENCE_EVENT, "sha256:debug-evidence-recovery"),
      payload: {
        type: DEBUG_EVIDENCE_EVENT,
        runId: RUN_ID,
        invocationIds: ["inv-1"],
        toolResultCount: 1,
      },
    });
    assert.equal(evidence.accessible.phase, "evidence");
    assert.match(evidence.html, /data-phase="evidence"/);
    assert.equal(evidence.accessible.canMarkCompleted, false);
  });
});
