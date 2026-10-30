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
import type { DualScenario } from "../../src/dual-driver.js";
import { UI02_SCENARIO } from "../../scenarios/ui-02-theme-panel.js";
import { UI03_SCENARIO } from "../../scenarios/ui-03-onboarding.js";
import { UI04_SCENARIO } from "../../scenarios/ui-04-agents-window.js";

const EXPECTED_EDITOR_EFFECTS: Record<string, readonly string[]> = {
  "UI-02": [
    "theme-change",
    "panel-width-change",
    "controls-readable",
    "conversation-preserved",
  ],
  "UI-03": [
    "onboarding-screen",
    "provider-profile-saved",
    "connection-test",
    "project-opened",
  ],
  "UI-04": ["agents-window", "parallel-local-runs", "back-to-editor"],
};

test("UI-02: tema claro/escuro e largura do painel com controle legível e conversa preservada", () => {
  const before = structuredClone(UI02_SCENARIO) as unknown;
  const result = driveEditorScenario(UI02_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "UI-02");
  assert.equal(result.scenarioId, "ui-02-theme-panel");
  assert.equal(result.steps, UI02_SCENARIO.steps.length);
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    assert.equal(side.productVersion, side.product === "cursor" ? FROZEN_CURSOR_VERSION : OPENAGENT_VERSION);
    const names = side.effects.map((effect) => effect.name);
    for (const name of EXPECTED_EDITOR_EFFECTS["UI-02"] ?? []) {
      assert.ok(names.includes(name), `efeito ausente: ${name}`);
    }
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "conversation-preserved"),
      { kind: "state", name: "conversation-preserved", value: { intact: true } },
    );
    const themes = side.effects
      .filter((effect) => effect.name === "theme-change")
      .map((effect) => (effect.value as { theme: "light" | "dark" }).theme);
    assert.deepEqual(themes, ["light", "dark"]);
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "controls-readable"),
      { kind: "accessibility", name: "controls-readable", value: true },
    );
  }
  assert.deepEqual(UI02_SCENARIO as unknown, before, "entrada UI-02 não deve ser mutada");
});

test("UI-02: cenário é determinístico e trivialmente repetível", () => {
  const first = driveEditorScenario(UI02_SCENARIO);
  const second = driveEditorScenario(UI02_SCENARIO);
  assert.deepEqual(second, first);
});

test("UI-03: onboarding conduz provedor, teste de conexão e projeto sem conta", () => {
  const before = structuredClone(UI03_SCENARIO) as unknown;
  const result = driveEditorScenario(UI03_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "UI-03");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    const names = side.effects.map((effect) => effect.name);
    for (const name of EXPECTED_EDITOR_EFFECTS["UI-03"] ?? []) {
      assert.ok(names.includes(name), `efeito ausente: ${name}`);
    }
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "connection-test"),
      { kind: "event", name: "connection-test", value: { ok: true } },
    );
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "project-opened"),
      {
        kind: "state",
        name: "project-opened",
        value: { folder: true, "account-required": false },
      },
    );
  }
  assert.deepEqual(UI03_SCENARIO as unknown, before, "entrada UI-03 não deve ser mutada");
});

test("UI-04: janela de agentes lista execuções locais em paralelo e volta ao editor", () => {
  const before = structuredClone(UI04_SCENARIO) as unknown;
  const result = driveEditorScenario(UI04_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "UI-04");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    const names = side.effects.map((effect) => effect.name);
    for (const name of EXPECTED_EDITOR_EFFECTS["UI-04"] ?? []) {
      assert.ok(names.includes(name), `efeito ausente: ${name}`);
    }
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "parallel-local-runs"),
      {
        kind: "ui",
        name: "parallel-local-runs",
        value: { runs: 2, "isolated-agents": true },
      },
    );
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "back-to-editor"),
      { kind: "state", name: "back-to-editor", value: { "same-workspace": true } },
    );
  }
  assert.deepEqual(UI04_SCENARIO as unknown, before, "entrada UI-04 não deve ser mutada");
});

test("conjunto do editor cobre LOC-01 e UI-01..UI-04 com paridade por efeito", () => {
  assert.equal(
    EDITOR_SCENARIOS.map((scenario) => scenario.requirementId).join(","),
    EDITOR_REQUIREMENT_IDS.join(","),
  );
  const coverage = editorScenarioCoverage();
  assert.deepEqual(coverage.missing, []);

  const runs = runAllEditorScenarios();
  assert.equal(runs.length, EDITOR_SCENARIOS.length);
  for (const run of runs) {
    assert.equal(run.ok, true, `cenário falhou: ${run.scenarioId}`);
  }

  // Divergência esperada: apenas a identidade de pacote (OpenAgent) do LOC-01.
  const loc01 = runs.find((run) => run.ok && run.requirementId === "LOC-01");
  assert.ok(loc01 && loc01.ok);
  assert.deepEqual(loc01.divergences, ["so-no-openagent: ui:package-identity"]);
  for (const run of runs) {
    if (!run.ok || run.requirementId !== "LOC-01") {
      assert.ok(run.ok);
      if (!run.ok) return;
      assert.deepEqual(run.divergences, []);
    }
  }
});

test("relatório do conjunto editor registra cada requisito, passos e divergências", () => {
  const report = formatEditorScenarioReport();
  const requirements = ["LOC-01", "UI-01", "UI-02", "UI-03", "UI-04"];
  const editorScenarios = [
    "loc-01-open-folder",
    "ui-01-agent-panel",
    "ui-02-theme-panel",
    "ui-03-onboarding",
    "ui-04-agents-window",
  ];
  for (const requirement of requirements) {
    assert.ok(report.includes(`[${requirement}]`), `requisito ausente do relatório: ${requirement}`);
  }
  for (const scenarioId of editorScenarios) {
    assert.ok(report.includes(scenarioId), `cenário ausente do relatório: ${scenarioId}`);
  }
  assert.ok(report.includes("divergencias: so-no-openagent: ui:package-identity"));
  assert.ok(report.includes("efeitos identicos"));
});

type MutableScenario = {
  requirementId?: string;
  scenarioId: string;
  openagent?: unknown;
  cursor: { effects: Record<string, unknown> };
};

test("caminho de erro: cenário inválido do conjunto retorna INVALID_STATE sem mutar", () => {
  const invalids: { label: string; input: unknown }[] = [
    (() => {
      const scenario = structuredClone(UI02_SCENARIO) as unknown as MutableScenario;
      delete scenario.requirementId;
      return { label: "sem requirementId", input: scenario as unknown };
    })(),
    (() => {
      const scenario = structuredClone(UI03_SCENARIO) as unknown as MutableScenario;
      scenario.cursor.effects["executar-teste-de-conexao"] = [
        { kind: "event", name: 1, value: true },
      ];
      return { label: "efeito com nome não textual", input: scenario as unknown };
    })(),
    (() => {
      const scenario = structuredClone(UI04_SCENARIO) as unknown as MutableScenario;
      delete scenario.openagent;
      return { label: "sem superfície OpenAgent", input: scenario as unknown };
    })(),
  ];

  for (const invalid of invalids) {
    const snapshot = structuredClone(invalid.input) as unknown;
    const result = driveEditorScenario(invalid.input as DualScenario);
    assert.equal(result.ok, false, `caso deveria falhar: ${invalid.label}`);
    if (!result.ok) {
      assert.equal(result.code, "INVALID_STATE");
    }
    assert.deepEqual(invalid.input, snapshot, `entrada mutada no caso: ${invalid.label}`);
  }
});
