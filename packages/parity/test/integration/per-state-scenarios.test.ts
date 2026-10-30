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
import { PER01_SCENARIO } from "../../scenarios/per-01-permission-accept.js";
import { PER02_SCENARIO } from "../../scenarios/per-02-cancel-execution.js";
import { PER03_SCENARIO } from "../../scenarios/per-03-readonly-block.js";
import { STA01_SCENARIO } from "../../scenarios/sta-01-terminal-state.js";
import { VAL01_SCENARIO } from "../../scenarios/val-01-empty-message.js";

const PER_STATE_SCENARIOS: readonly DualScenario[] = [
  PER01_SCENARIO,
  PER02_SCENARIO,
  PER03_SCENARIO,
  STA01_SCENARIO,
  VAL01_SCENARIO,
];

const PER_STATE_EFFECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "PER-01": ["permission-request", "explicit-accept", "tool-executed"],
  "PER-02": ["cancel-requested", "cancelled-state", "applied-change-preserved", "new-tool-denied"],
  "PER-03": ["readonly-mode-active", "file-write-blocked", "mutating-command-blocked"],
  "STA-01": ["run-terminal-state", "new-tool-denied", "new-message-accepts-tool"],
  "VAL-01": ["empty-message-refused", "message-sent"],
};

const perStateScenario = (requirementId: string): DualScenario => {
  const found = PER_STATE_SCENARIOS.find((s) => s.requirementId === requirementId);
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

test("PER-01: permissão mostra ação, alvo e escopo antes de executar", () => {
  const before = structuredClone(PER01_SCENARIO) as unknown;
  const result = driveEditorScenario(PER01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "PER-01");
  assert.equal(result.scenarioId, "per-01-permission-accept");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    assert.equal(side.productVersion, side.product === "cursor" ? FROZEN_CURSOR_VERSION : OPENAGENT_VERSION);
    for (const name of PER_STATE_EFFECT_NAMES["PER-01"] ?? []) {
      assert.ok(side.effects.some((effect) => effect.name === name), `efeito ausente: ${name}`);
    }
    expectEffect(side.effects, "permission-request", {
      kind: "ui",
      value: { action: "edit", target: "src/service.ts", scope: "workspace", visible: true },
    });
    expectEffect(side.effects, "explicit-accept", {
      kind: "state",
      value: { accepted: true, "granted-before-execution": true },
    });
    // Ordem: aceite explícito vem antes da execução da ferramenta.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("explicit-accept") < order.indexOf("tool-executed"),
      "ferramenta executada antes do aceite explícito",
    );
  }
  assert.deepEqual(PER01_SCENARIO as unknown, before, "entrada PER-01 não deve ser mutada");
});

test("PER-02: cancelamento marca Cancelada em até 2 segundos, conserva alteração e recusa ferramenta nova", () => {
  const result = driveEditorScenario(perStateScenario("PER-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "cancel-requested", {
      kind: "event",
      value: { during: "execution" },
    });
    expectEffect(side.effects, "cancelled-state", {
      kind: "state",
      value: { state: "cancelled", "within-seconds": 2 },
    });
    expectEffect(side.effects, "applied-change-preserved", {
      kind: "diff",
      value: { preserved: true, files: ["src/service.ts"] },
    });
    expectEffect(side.effects, "new-tool-denied", {
      kind: "error",
      value: { code: "CANCELLED", "in-same-run": true },
    });
    // Ordem: estado Cancelada e alteração preservada antes da recusa.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("cancelled-state") < order.indexOf("new-tool-denied"),
      "recusa de ferramenta antes de marcar Cancelada",
    );
    assert.ok(
      order.indexOf("cancel-requested") < order.indexOf("applied-change-preserved"),
      "alteração preservada antes do cancelamento",
    );
  }
});

test("PER-03: Somente leitura bloqueia gravação e comando mutável com mensagem específica", () => {
  const result = driveEditorScenario(perStateScenario("PER-03"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "readonly-mode-active", {
      kind: "state",
      value: { mode: "readonly", active: true },
    });
    expectEffect(side.effects, "file-write-blocked", {
      kind: "error",
      value: { code: "PERMISSION_DENIED", action: "file-write", message: "Bloqueado pelo modo de execução." },
    });
    expectEffect(side.effects, "mutating-command-blocked", {
      kind: "error",
      value: { code: "PERMISSION_DENIED", action: "shell-command", message: "Bloqueado pelo modo de execução." },
    });
  }
});

test("STA-01: execução terminal recusa ferramenta nova até uma mensagem nova", () => {
  const result = driveEditorScenario(perStateScenario("STA-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "run-terminal-state", {
      kind: "state",
      value: { states: ["completed", "cancelled"], terminal: true },
    });
    expectEffect(side.effects, "new-tool-denied", {
      kind: "error",
      value: { code: "INVALID_STATE", "in-same-run": true },
    });
    expectEffect(side.effects, "new-message-accepts-tool", {
      kind: "event",
      value: { accepted: true, after: "new-message" },
    });
    // Ordem: recusa na execução terminal vem antes do aceite de mensagem nova.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("new-tool-denied") < order.indexOf("new-message-accepts-tool"),
      "ferramenta aceita sem mensagem nova",
    );
  }
});

test("VAL-01: envio vazio é recusado com a mensagem do produto e anexo libera envio", () => {
  const result = driveEditorScenario(perStateScenario("VAL-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "empty-message-refused", {
      kind: "error",
      value: { sent: false, message: "Escreva uma mensagem ou anexe um contexto." },
    });
    expectEffect(side.effects, "message-sent", {
      kind: "state",
      value: { sent: true, attachments: 1 },
    });
  }
});

test("cenários de permissão e estado são determinísticos e repetíveis", () => {
  for (const scenario of PER_STATE_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("conjunto completo cobre os 46 requisitos com a única divergência declarada do LOC-01", () => {
  assert.equal(EDITOR_SCENARIOS.length, 46);
  assert.equal(EDITOR_SCENARIOS.length, EDITOR_REQUIREMENT_IDS.length);
  assert.deepEqual(
    EDITOR_SCENARIOS.map((scenario) => scenario.requirementId).join(","),
    EDITOR_REQUIREMENT_IDS.join(","),
  );

  const coverage = editorScenarioCoverage();
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.covered.length, 46);

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

test("relatório registra os cenários de permissão e estado por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["PER-01", "PER-02", "PER-03", "STA-01", "VAL-01"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
  }
  for (const scenario of PER_STATE_SCENARIOS) {
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 46/46"));
});
