import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARNESS_EVENT_SCHEMA_VERSION,
  ProtocolError,
  RPC_METHOD,
} from "@openagent/protocol";

import {
  RUN_CANCEL_DEADLINE_MS,
  RUN_CANCELLED_EVENT,
  RunCancelPanelController,
} from "../../src/agent/run-cancel-panel.js";

const RUN_ID = "run-per-02-cancel-e2e";

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

describe("PER-02 e2e — Cancelar run e ver Cancelada em até 2 s", () => {
  it("[PER-02] cancelar marca Cancelada em ≤2s, bloqueia nova ferramenta e conserva alteração", () => {
    let clock = 1_000_000;
    const panel = new RunCancelPanelController(RUN_ID, { now: () => clock });

    assert.match(panel.snapshot.html, /data-testid="run-cancel-panel"/);
    assert.equal(panel.snapshot.accessible.runState, "idle");
    assert.equal(panel.snapshot.accessible.statusLabel, "Ociosa");
    assert.equal(panel.snapshot.accessible.canCancel, false);

    panel.beginRunning();
    assert.equal(panel.snapshot.accessible.runState, "running");
    assert.equal(panel.snapshot.accessible.statusLabel, "Em execução");
    assert.match(panel.snapshot.html, /data-run-state="running"/);
    assert.match(panel.snapshot.html, /data-testid="run-cancel-button"/);
    assert.match(panel.snapshot.html, /Em execução/);

    panel.recordAppliedChange({
      changeId: "chg-1",
      path: "src/app.ts",
      summary: "Ajuste no handler",
    });
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 1);
    assert.deepEqual([...panel.snapshot.accessible.appliedChangeIds], ["chg-1"]);
    assert.match(panel.snapshot.html, /data-testid="run-applied-change"/);
    assert.match(panel.snapshot.html, /src\/app\.ts/);
    assert.match(panel.snapshot.html, /Ajuste no handler/);

    assert.deepEqual(panel.beginToolInvocation("shell"), {
      accepted: true,
      toolId: "shell",
    });

    // requestCancel só emite RPC — estado atualiza no eco run.cancelled.
    const pending = panel.requestCancel();
    assert.equal(pending.rpc.method, RPC_METHOD.RUN_CANCEL);
    assert.deepEqual(pending.rpc.params, {});
    assert.equal(pending.view.accessible.runState, "running");
    assert.equal(pending.view.accessible.statusLabel, "Em execução");
    assert.equal(pending.cancelRequestedAtMs, clock);

    // Eco do daemon dentro do prazo PER-02 (2000 ms).
    clock += 350;
    const cancelled = panel.push({
      event: harnessEvent(1, RUN_CANCELLED_EVENT, "sha256:run-cancelled"),
      payload: { type: RUN_CANCELLED_EVENT, runId: RUN_ID, endedAt: "2026-10-28T10:00:00.000Z" },
    });

    assert.equal(cancelled.accessible.runState, "cancelled");
    assert.equal(cancelled.accessible.statusLabel, "Cancelada");
    assert.equal(cancelled.accessible.canCancel, false);
    assert.equal(cancelled.accessible.cancelLatencyMs, 350);
    const latencyMs = cancelled.accessible.cancelLatencyMs;
    assert.ok(latencyMs !== null && latencyMs <= RUN_CANCEL_DEADLINE_MS);
    assert.match(cancelled.html, /data-run-state="cancelled"/);
    assert.match(cancelled.html, /data-testid="run-cancel-status"/);
    assert.match(cancelled.html, />Cancelada</);
    assert.match(cancelled.html, /data-cancel-latency-ms="350"/);
    assert.doesNotMatch(cancelled.html, /data-testid="run-cancel-button"/);

    // Conserva alteração já aplicada.
    assert.equal(cancelled.accessible.appliedChangeCount, 1);
    assert.deepEqual([...cancelled.accessible.appliedChangeIds], ["chg-1"]);
    assert.match(cancelled.html, /data-change-id="chg-1"/);
    assert.match(cancelled.html, /src\/app\.ts/);
    assert.deepEqual(
      panel.listAppliedChanges().map((c) => c.changeId),
      ["chg-1"],
    );

    // Não inicia ferramenta nova nesta execução.
    assert.throws(
      () => panel.beginToolInvocation("file.write"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        assert.equal(error.hints?.runState, "cancelled");
        assert.equal(error.hints?.requiresNewUserMessage, true);
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 1);
    assert.equal(panel.snapshot.accessible.runState, "cancelled");
  });

  it("[PER-02] caminho de erro: entrada/estado inválidos retornam INVALID_STATE sem efeito colateral", () => {
    const panel = new RunCancelPanelController(RUN_ID);
    const baseline = panel.snapshot;

    assert.throws(
      () => panel.requestCancel(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.runState, baseline.accessible.runState);
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 0);

    assert.throws(
      () => new RunCancelPanelController(""),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );

    assert.throws(
      () => panel.beginToolInvocation(""),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.runState, "idle");

    panel.beginRunning();
    panel.recordAppliedChange({
      changeId: "chg-keep",
      path: "a.ts",
      summary: "keep",
    });

    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(1, "tool.result", "sha256:wrong"),
          payload: {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.runState, "running");
    assert.deepEqual([...panel.snapshot.accessible.appliedChangeIds], ["chg-keep"]);

    assert.throws(
      () =>
        panel.push({
          event: {
            ...harnessEvent(1, RUN_CANCELLED_EVENT, "sha256:bad-run"),
            runId: "outro-run",
          },
          payload: { runId: "outro-run" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.runState, "running");
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 1);

    assert.throws(
      () => panel.recordAppliedChange({ changeId: "", path: "x", summary: "y" }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 1);

    // Duplo cancel / cancel após eco.
    panel.requestCancel();
    panel.push({
      event: harnessEvent(1, RUN_CANCELLED_EVENT, "sha256:ok"),
      payload: { runId: RUN_ID },
    });
    assert.throws(
      () => panel.requestCancel(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.accessible.runState, "cancelled");
    assert.equal(panel.snapshot.accessible.appliedChangeCount, 1);
  });
});
