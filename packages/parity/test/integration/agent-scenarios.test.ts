import test from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_SCENARIOS,
  EDITOR_REQUIREMENT_IDS,
  driveEditorScenario,
  editorScenarioCoverage,
  formatEditorScenarioReport,
  runAllEditorScenarios,
} from "../../src/scenarios.js";
import { FROZEN_CURSOR_VERSION, OPENAGENT_VERSION } from "../../src/dual-driver.js";
import type { DualScenario, CaptureEffect } from "../../src/dual-driver.js";
import { AGT01_SCENARIO } from "../../scenarios/agt-01-ask-no-mutation.js";
import { AGT02_SCENARIO } from "../../scenarios/agt-02-plan-execution.js";
import { AGT03_SCENARIO } from "../../scenarios/agt-03-agent-multi-file-diff.js";
import { AGT04_SCENARIO } from "../../scenarios/agt-04-debug-hypothesis-evidence.js";
import { AGT05_SCENARIO } from "../../scenarios/agt-05-subagents-named.js";
import { AGT06_SCENARIO } from "../../scenarios/agt-06-message-queue.js";
import { AGT07_SCENARIO } from "../../scenarios/agt-07-subagent-cancel.js";
import { PRJ01_SCENARIO } from "../../scenarios/prj-01-local-coordinator.js";

const AGENT_SCENARIOS: readonly DualScenario[] = [
  AGT01_SCENARIO,
  AGT02_SCENARIO,
  AGT03_SCENARIO,
  AGT04_SCENARIO,
  AGT05_SCENARIO,
  AGT06_SCENARIO,
  AGT07_SCENARIO,
  PRJ01_SCENARIO,
];

const AGENT_EFFECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "AGT-01": ["mode-selected", "question-sent", "tool-usage", "workspace-mutation"],
  "AGT-02": ["plan-proposal", "plan-accepted", "execution-started", "execution-progress"],
  "AGT-03": ["agent-run", "multi-file-edit", "test-run", "grouped-diff", "tool-results"],
  "AGT-04": ["debug-hypothesis", "execution-evidence", "verification-result", "task-completion"],
  "AGT-05": ["subagent-list", "subagent-entries", "subagent-results"],
  "AGT-06": ["message-queued", "queue-items", "queue-item-removed", "queue-item-removal-denied"],
  "AGT-07": ["subagent-cancelled", "remaining-subagents-intact"],
  "PRJ-01": ["project-created", "coordinator-plan", "task-results", "result-decision"],
};

const agentScenario = (requirementId: string): DualScenario => {
  const found = AGENT_SCENARIOS.find((s) => s.requirementId === requirementId);
  assert.ok(found, `cenário ausente: ${requirementId}`);
  return found as DualScenario;
};

function expectEffect(
  effects: readonly CaptureEffect[],
  name: string,
  expected: Omit<CaptureEffect, "name">,
): void {
  assert.deepEqual(
    effects.find((effect) => effect.name === name),
    { ...expected, name },
    `efeito divergente: ${name}`,
  );
}

test("AGT-01: Ask responde com leitura e busca sem gravar arquivo nem executar comando", () => {
  const before = structuredClone(AGT01_SCENARIO) as unknown;
  const result = driveEditorScenario(AGT01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "AGT-01");
  assert.equal(result.scenarioId, "agt-01-ask-no-mutation");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    assert.equal(side.productVersion, side.product === "cursor" ? FROZEN_CURSOR_VERSION : OPENAGENT_VERSION);
    for (const name of AGENT_EFFECT_NAMES["AGT-01"] ?? []) {
      assert.ok(side.effects.some((effect) => effect.name === name), `efeito ausente: ${name}`);
    }
    expectEffect(side.effects, "tool-usage", {
      kind: "event",
      value: { tools: ["read", "search"], mutating: false },
    });
    expectEffect(side.effects, "workspace-mutation", {
      kind: "state",
      value: { "files-written": 0, "commands-executed": 0 },
    });
  }
  assert.deepEqual(AGT01_SCENARIO as unknown, before, "entrada AGT-01 não deve ser mutada");
});

test("AGT-02: aceitar plano inicia execução com plano e progresso visíveis", () => {
  const result = driveEditorScenario(agentScenario("AGT-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "plan-proposal", {
      kind: "ui",
      value: { steps: 3, visible: true },
    });
    expectEffect(side.effects, "plan-accepted", { kind: "state", value: { accepted: true } });
    expectEffect(side.effects, "execution-started", {
      kind: "event",
      value: { "plan-visible": true },
    });
    expectEffect(side.effects, "execution-progress", {
      kind: "ui",
      value: { steps: { done: 1, total: 3 }, visible: true },
    });
  }
});

test("AGT-03: modo Agent edita três arquivos, roda teste autorizado e mostra diff agrupado", () => {
  const result = driveEditorScenario(agentScenario("AGT-03"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "multi-file-edit", {
      kind: "diff",
      value: { files: ["model.ts", "service.ts", "model.test.ts"], count: 3 },
    });
    expectEffect(side.effects, "test-run", {
      kind: "event",
      value: { authorized: true, result: "pass" },
    });
    expectEffect(side.effects, "grouped-diff", {
      kind: "ui",
      value: { files: 3, grouped: true },
    });
    expectEffect(side.effects, "tool-results", {
      kind: "ui",
      value: { tools: ["edit", "edit", "edit", "test"], reported: "per-tool" },
    });
  }
});

test("AGT-04: Debug registra hipótese, evidência e verificação antes de concluir", () => {
  const result = driveEditorScenario(agentScenario("AGT-04"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "debug-hypothesis", {
      kind: "state",
      value: { recorded: true, conclusion: "pending" },
    });
    expectEffect(side.effects, "execution-evidence", {
      kind: "event",
      value: { collected: true, source: "test-run" },
    });
    expectEffect(side.effects, "verification-result", {
      kind: "event",
      value: { confirmed: true },
    });
    // Ordem: conclusão só depois de hipótese + evidência + verificação.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("task-completion") >
        Math.max(
          order.indexOf("debug-hypothesis"),
          order.indexOf("execution-evidence"),
          order.indexOf("verification-result"),
        ),
      "tarefa concluída antes de hipótese/evidência/verificação",
    );
  }
});

test("AGT-05: cada subagente local tem nome, estado e resultado próprios", () => {
  const result = driveEditorScenario(agentScenario("AGT-05"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  const expected = {
    agents: [
      { name: "explorar-workspace", state: "done", result: "found" },
      { name: "atualizar-imports", state: "done", result: "patched" },
    ],
  };
  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "subagent-list", { kind: "ui", value: { count: 2, local: true } });
    expectEffect(side.effects, "subagent-entries", { kind: "ui", value: expected });
    expectEffect(side.effects, "subagent-results", { kind: "ui", value: { "per-agent": true } });
  }
});

test("AGT-06: mensagem em execução entra na fila e item não iniciado pode ser removido", () => {
  const result = driveEditorScenario(agentScenario("AGT-06"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "message-queued", {
      kind: "state",
      value: { queued: true, ordinal: 1 },
    });
    expectEffect(side.effects, "queue-items", {
      kind: "ui",
      value: { count: 2, ordered: true },
    });
    expectEffect(side.effects, "queue-item-removed", {
      kind: "state",
      value: { "not-started": true, remaining: 1 },
    });
    // Item já iniciado: remoção é recusada com CONFLICT.
    expectEffect(side.effects, "queue-item-removal-denied", {
      kind: "error",
      value: { code: "CONFLICT", "not-started-only": true },
    });
  }
});

test("AGT-07: cancelar um subagente interrompe só ele e conserva os demais", () => {
  const result = driveEditorScenario(agentScenario("AGT-07"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "subagent-cancelled", {
      kind: "event",
      value: { agent: "atualizar-imports", "parent-run": "kept" },
    });
    expectEffect(side.effects, "remaining-subagents-intact", {
      kind: "state",
      value: { affected: 0, preserved: ["explorar-workspace"] },
    });
  }
});

test("PRJ-01: coordenador local divide o objetivo e mostra resultado de cada tarefa", () => {
  const before = structuredClone(PRJ01_SCENARIO) as unknown;
  const result = driveEditorScenario(PRJ01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "project-created", {
      kind: "state",
      value: { objective: "refatorar-modulo", local: true },
    });
    expectEffect(side.effects, "coordinator-plan", {
      kind: "ui",
      value: { tasks: 3, "same-machine": true },
    });
    expectEffect(side.effects, "task-results", {
      kind: "ui",
      value: { results: ["applied", "applied", "failed"], "per-task": true },
    });
    expectEffect(side.effects, "result-decision", {
      kind: "ui",
      value: { options: ["accept", "reject"], submitted: "accept" },
    });
  }
  assert.deepEqual(PRJ01_SCENARIO as unknown, before, "entrada PRJ-01 não deve ser mutada");
});

test("cenários do agente são determinísticos e repetíveis", () => {
  for (const scenario of AGENT_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("conjunto completo cobre os 39 requisitos com a única divergência declarada do LOC-01", () => {
  assert.equal(EDITOR_SCENARIOS.length, 39);
  assert.equal(EDITOR_SCENARIOS.length, EDITOR_REQUIREMENT_IDS.length);
  assert.deepEqual(
    EDITOR_SCENARIOS.map((scenario) => scenario.requirementId).join(","),
    EDITOR_REQUIREMENT_IDS.join(","),
  );

  const coverage = editorScenarioCoverage();
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.covered.length, 39);

  const runs = runAllEditorScenarios();
  for (const run of runs) {
    assert.equal(run.ok, true, `cenário falhou: ${run.scenarioId}`);
  }
  for (const run of runs) {
    if (!run.ok) return;
    const expected = run.requirementId === "LOC-01"
      ? ["so-no-openagent: ui:package-identity"]
      : [];
    assert.deepEqual(run.divergences, expected, `divergências em ${run.requirementId}`);
  }
});

test("relatório registra os cenários do agente por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["AGT-01", "AGT-02", "AGT-03", "AGT-04", "AGT-05", "AGT-06", "AGT-07", "PRJ-01"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
  }
  for (const scenario of AGENT_SCENARIOS) {
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("efeitos identicos"));
  assert.ok(report.includes("divergencias: so-no-openagent: ui:package-identity"));
});
