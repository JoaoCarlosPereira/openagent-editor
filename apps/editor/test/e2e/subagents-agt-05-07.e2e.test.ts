import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARNESS_EVENT_SCHEMA_VERSION,
  ProtocolError,
  RPC_METHOD,
} from "@openagent/protocol";

import {
  AGENT_CANCELLED_EVENT,
  AGENT_COMPLETED_EVENT,
  AGENT_SPAWNED_EVENT,
  SubagentsPanelController,
} from "../../src/review/subagents-panel.js";

const RUN_ID = "run-agt-05-07-subagents-e2e";
const AGENT_A = "agent-a-research";
const AGENT_B = "agent-b-implement";

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

describe("AGT-05/AGT-07 e2e — subagentes visíveis e cancelamento isolado", () => {
  it("[AGT-05] após dividir a tarefa mostra cada subagente com nome, estado e resultado próprios", () => {
    const panel = new SubagentsPanelController(RUN_ID);

    assert.match(panel.snapshot.html, /data-testid="subagents-empty"/);
    assert.equal(panel.snapshot.accessible.agents.length, 0);

    const spawnedA = panel.push({
      event: harnessEvent(1, AGENT_SPAWNED_EVENT, "sha256:spawn-a"),
      payload: {
        type: AGENT_SPAWNED_EVENT,
        runId: RUN_ID,
        agentId: AGENT_A,
        name: "Pesquisar API",
        objective: "Pesquisar API",
      },
    });

    assert.match(spawnedA.html, /data-testid="subagents-panel"/);
    assert.match(spawnedA.html, /data-testid="subagent-row"/);
    assert.match(spawnedA.html, /data-agent-id="agent-a-research"/);
    assert.match(spawnedA.html, /data-state="running"/);
    assert.match(spawnedA.html, /data-testid="subagent-name"/);
    assert.match(spawnedA.html, /Pesquisar API/);
    assert.match(spawnedA.html, /data-testid="subagent-state"/);
    assert.match(spawnedA.html, /Em execução/);
    assert.match(spawnedA.html, /data-testid="subagent-cancel"/);
    assert.equal(spawnedA.accessible.runningCount, 1);
    assert.equal(spawnedA.accessible.agents[0]?.state, "running");
    assert.equal(spawnedA.accessible.agents[0]?.resultRef, null);

    const spawnedB = panel.push({
      event: harnessEvent(2, AGENT_SPAWNED_EVENT, "sha256:spawn-b"),
      payload: {
        type: AGENT_SPAWNED_EVENT,
        runId: RUN_ID,
        agentId: AGENT_B,
        name: "Implementar patch",
      },
    });

    assert.equal(spawnedB.accessible.agents.length, 2);
    assert.equal(spawnedB.accessible.runningCount, 2);
    assert.match(spawnedB.html, /Implementar patch/);
    assert.match(spawnedB.html, /data-agent-id="agent-b-implement"/);

    const completedA = panel.push({
      event: harnessEvent(3, AGENT_COMPLETED_EVENT, "sha256:complete-a"),
      payload: {
        type: AGENT_COMPLETED_EVENT,
        runId: RUN_ID,
        agentId: AGENT_A,
        name: "Pesquisar API",
        resultRef: "sha256:result-a",
        resultSummary: "Endpoints documentados.",
      },
    });

    const rowA = completedA.accessible.agents.find((a) => a.agentId === AGENT_A);
    const rowB = completedA.accessible.agents.find((a) => a.agentId === AGENT_B);
    assert.equal(rowA?.state, "complete");
    assert.equal(rowA?.resultRef, "sha256:result-a");
    assert.equal(rowA?.resultSummary, "Endpoints documentados.");
    assert.equal(rowB?.state, "running");
    assert.equal(rowB?.resultRef, null);
    assert.equal(completedA.accessible.completeCount, 1);
    assert.equal(completedA.accessible.runningCount, 1);
    assert.match(completedA.html, /data-state="complete"/);
    assert.match(completedA.html, /data-testid="subagent-result-ref"/);
    assert.match(completedA.html, /sha256:result-a/);
    assert.match(completedA.html, /Endpoints documentados/);
    assert.match(completedA.html, /data-state="running"/);
  });

  it("[AGT-07] cancelar um subagente interrompe só esse e conserva o estado dos demais", () => {
    const panel = new SubagentsPanelController(RUN_ID);

    panel.push({
      event: harnessEvent(1, AGENT_SPAWNED_EVENT, "sha256:spawn-a"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });
    panel.push({
      event: harnessEvent(2, AGENT_SPAWNED_EVENT, "sha256:spawn-b"),
      payload: { agentId: AGENT_B, name: "Implementar patch" },
    });

    const beforeB = panel.listAgents().find((a) => a.agentId === AGENT_B);
    assert.equal(beforeB?.state, "running");

    // cancelSubagent só emite RPC — estado atualiza no eco agent.cancelled (sequence).
    const pending = panel.cancelSubagent(AGENT_A);

    assert.equal(pending.rpc.method, RPC_METHOD.AGENT_CANCEL);
    assert.deepEqual(pending.rpc.params, { agentId: AGENT_A });
    assert.equal(
      pending.view.accessible.agents.find((a) => a.agentId === AGENT_A)?.state,
      "running",
    );
    assert.equal(
      pending.view.accessible.agents.find((a) => a.agentId === AGENT_B)?.state,
      "running",
    );

    const cancelled = panel.push({
      event: harnessEvent(3, AGENT_CANCELLED_EVENT, "sha256:cancel-a"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });

    const afterA = cancelled.accessible.agents.find((a) => a.agentId === AGENT_A);
    const afterB = cancelled.accessible.agents.find((a) => a.agentId === AGENT_B);
    assert.equal(afterA?.state, "cancelled");
    assert.equal(afterA?.resultRef, null);
    assert.equal(afterB?.state, "running");
    assert.equal(afterB?.name, "Implementar patch");
    assert.equal(cancelled.accessible.cancelledCount, 1);
    assert.equal(cancelled.accessible.runningCount, 1);
    assert.match(cancelled.html, /data-agent-id="agent-a-research"[^>]*data-state="cancelled"/);
    assert.match(cancelled.html, /data-agent-id="agent-b-implement"[^>]*data-state="running"/);
    assert.match(cancelled.html, /data-testid="subagent-cancelled-notice"/);
    assert.doesNotMatch(
      cancelled.html,
      /data-testid="subagent-cancel" data-agent-id="agent-a-research"/,
    );
    assert.match(
      cancelled.html,
      /data-testid="subagent-cancel" data-agent-id="agent-b-implement"/,
    );

    // Cancelar o irmão via evento também isola sem afetar A já cancelled.
    const viaEvent = panel.push({
      event: harnessEvent(4, AGENT_CANCELLED_EVENT, "sha256:cancel-b"),
      payload: { agentId: AGENT_B, name: "Implementar patch" },
    });
    assert.equal(viaEvent.accessible.cancelledCount, 2);
    assert.equal(viaEvent.accessible.runningCount, 0);
    const bFinal = viaEvent.accessible.agents.find((a) => a.agentId === AGENT_B);
    const aFinal = viaEvent.accessible.agents.find((a) => a.agentId === AGENT_A);
    assert.equal(bFinal?.state, "cancelled");
    assert.equal(aFinal?.state, "cancelled");
  });

  it("[AGT-07] eco agent.cancelled após cancelSubagent aceita sequence e irmão ainda recebe eventos", () => {
    const panel = new SubagentsPanelController(RUN_ID);

    panel.push({
      event: harnessEvent(1, AGENT_SPAWNED_EVENT, "sha256:spawn-a"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });
    panel.push({
      event: harnessEvent(2, AGENT_SPAWNED_EVENT, "sha256:spawn-b"),
      payload: { agentId: AGENT_B, name: "Implementar patch" },
    });

    const pending = panel.cancelSubagent(AGENT_A);
    assert.equal(pending.rpc.params.agentId, AGENT_A);
    assert.equal(panel.listAgents().find((a) => a.agentId === AGENT_A)?.state, "running");
    assert.equal(panel.listAgents().find((a) => a.agentId === AGENT_B)?.state, "running");

    // Eco do daemon para A — deve aceitar sequence (não rejeitar "já cancelado").
    const echo = panel.push({
      event: harnessEvent(3, AGENT_CANCELLED_EVENT, "sha256:echo-cancel-a"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });
    assert.equal(echo.accessible.agents.find((a) => a.agentId === AGENT_A)?.state, "cancelled");
    assert.equal(echo.accessible.agents.find((a) => a.agentId === AGENT_B)?.state, "running");

    // Irmão B ainda recebe completed na sequence seguinte.
    const siblingDone = panel.push({
      event: harnessEvent(4, AGENT_COMPLETED_EVENT, "sha256:complete-b"),
      payload: {
        agentId: AGENT_B,
        name: "Implementar patch",
        resultRef: "sha256:result-b",
        resultSummary: "Patch aplicado.",
      },
    });
    assert.equal(
      siblingDone.accessible.agents.find((a) => a.agentId === AGENT_B)?.state,
      "complete",
    );
    assert.equal(
      siblingDone.accessible.agents.find((a) => a.agentId === AGENT_B)?.resultRef,
      "sha256:result-b",
    );
    assert.equal(
      siblingDone.accessible.agents.find((a) => a.agentId === AGENT_A)?.state,
      "cancelled",
    );
    assert.equal(siblingDone.accessible.completeCount, 1);
    assert.equal(siblingDone.accessible.cancelledCount, 1);
    assert.equal(siblingDone.accessible.runningCount, 0);

    // Eco duplicado de cancelado ainda é idempotente e avança sequence.
    const dupEcho = panel.push({
      event: harnessEvent(5, AGENT_CANCELLED_EVENT, "sha256:dup-cancel-a"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });
    assert.equal(dupEcho.accessible.cancelledCount, 1);
    assert.equal(dupEcho.accessible.agents.find((a) => a.agentId === AGENT_A)?.state, "cancelled");
  });

  it("[AGT-05] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
    const panel = new SubagentsPanelController(RUN_ID);
    panel.push({
      event: harnessEvent(1, AGENT_SPAWNED_EVENT, "sha256:ok"),
      payload: { agentId: AGENT_A, name: "Pesquisar API" },
    });
    const before = panel.snapshot.html;
    const beforeAgents = panel.listAgents().map((a) => ({ ...a }));

    assert.throws(
      () =>
        panel.push({
          event: { sequence: 0, runId: RUN_ID, type: AGENT_SPAWNED_EVENT },
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
      () => panel.cancelSubagent(""),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);

    assert.throws(
      () => panel.cancelSubagent("agent-inexistente"),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);
    assert.deepEqual(
      panel.listAgents().map((a) => ({ ...a })),
      beforeAgents,
    );

    // completed sem spawn prévio não muta.
    assert.throws(
      () =>
        panel.push({
          event: harnessEvent(2, AGENT_COMPLETED_EVENT, "sha256:orphan"),
          payload: {
            agentId: AGENT_B,
            name: "Órfão",
            resultRef: "sha256:x",
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(panel.snapshot.html, before);
    assert.equal(panel.snapshot.accessible.agents.length, 1);
    assert.equal(panel.snapshot.accessible.agents[0]?.state, "running");
  });
});
