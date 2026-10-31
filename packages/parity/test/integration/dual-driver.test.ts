import test from "node:test";
import assert from "node:assert/strict";
import {
  driveDualCapture,
  FROZEN_CURSOR_VERSION,
  OPENAGENT_VERSION,
} from "../../src/dual-driver.js";
import type { DualScenario } from "../../src/dual-driver.js";
import { LOC01_SCENARIO } from "../../scenarios/loc-01-open-folder.js";
import { UI01_SCENARIO } from "../../scenarios/ui-01-agent-panel.js";

const LOC01_CURSOR_EFFECT_NAMES = [
  "workspace-opened",
  "file-edited",
  "terminal-panel",
  "git-panel",
  "debug-session",
  "extension-installed",
];

const LOC01_OPENAGENT_EFFECT_NAMES = [...LOC01_CURSOR_EFFECT_NAMES, "package-identity"];

const UI01_EFFECT_NAMES = [
  "agent-panel",
  "mode-selector",
  "model-selector",
  "context-attachment",
  "history",
  "change-review",
  "keyboard-accessible",
];

const NO_MUTATED = (scenario: DualScenario, before: unknown, label: string) => {
  assert.deepEqual(scenario as unknown, before, label);
};

test("LOC-01: driver dual captura o mesmo cenário no Cursor 3.24.18 congelado e no OpenAgent", () => {
  const before = structuredClone(LOC01_SCENARIO) as unknown;
  const result = driveDualCapture(LOC01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { cursor, openagent } = result;
  assert.equal(cursor.product, "cursor");
  assert.equal(cursor.productVersion, FROZEN_CURSOR_VERSION);
  assert.equal(cursor.scenarioId, "loc-01-open-folder");
  assert.equal(cursor.requirementId, "LOC-01");
  assert.equal(openagent.product, "openagent");
  assert.equal(openagent.productVersion, OPENAGENT_VERSION);
  assert.equal(openagent.scenarioId, "loc-01-open-folder");
  assert.equal(openagent.requirementId, "LOC-01");
  assert.equal(cursor.platform, openagent.platform);

  const cursorNames = cursor.effects.map((effect) => effect.name);
  for (const name of LOC01_CURSOR_EFFECT_NAMES) {
    assert.ok(cursorNames.includes(name), `efeito ausente no lado congelado: ${name}`);
  }
  assert.ok(!cursorNames.includes("package-identity"));

  const openagentNames = openagent.effects.map((effect) => effect.name);
  for (const name of LOC01_OPENAGENT_EFFECT_NAMES) {
    assert.ok(openagentNames.includes(name), `efeito ausente no lado OpenAgent: ${name}`);
  }
  const identity = openagent.effects.find((effect) => effect.name === "package-identity");
  assert.deepEqual(identity, {
    kind: "ui",
    name: "package-identity",
    value: { name: "OpenAgent", icon: "openagent" },
  });
  NO_MUTATED(LOC01_SCENARIO, before, "entrada LOC-01 não deve ser mutada pelo driver");
});

test("LOC-01: driver dual é determinístico (erros de captura invalidam, dados válidos coincidem)", () => {
  const first = driveDualCapture(LOC01_SCENARIO);
  const second = driveDualCapture(LOC01_SCENARIO);
  assert.deepEqual(second, first);
  assert.deepEqual(driveDualCapture(structuredClone(LOC01_SCENARIO) as unknown), first);
});

test("UI-01: driver dual captura painel, seletores, contexto, histórico, revisão e acessibilidade", () => {
  const before = structuredClone(UI01_SCENARIO) as unknown;
  const result = driveDualCapture(UI01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { cursor, openagent } = result;
  assert.equal(cursor.requirementId, "UI-01");
  assert.equal(openagent.requirementId, "UI-01");
  assert.equal(cursor.productVersion, FROZEN_CURSOR_VERSION);
  assert.ok(cursor.effects.length > 0);
  for (const side of [cursor, openagent]) {
    const names = side.effects.map((effect) => effect.name);
    for (const name of UI01_EFFECT_NAMES) {
      assert.ok(names.includes(name), `efeito ausente: ${name}`);
    }
    const keyboard = side.effects.find((effect) => effect.name === "keyboard-accessible");
    assert.deepEqual(keyboard, { kind: "accessibility", name: "keyboard-accessible", value: true });
    assert.deepEqual(
      side.effects.find((effect) => effect.name === "mode-selector"),
      { kind: "ui", name: "mode-selector", value: { modes: ["ask", "plan", "agent"] } },
    );
  }
  assert.equal(openagent.effects.length, cursor.effects.length);
  NO_MUTATED(UI01_SCENARIO, before, "entrada UI-01 não deve ser mutada pelo driver");
});

type MutableScenario = {
  scenarioId: string;
  requirementId: string;
  steps: unknown;
  cursor: Record<string, unknown>;
  openagent: Record<string, unknown>;
};

const mutate = (label: string, apply: (scenario: MutableScenario) => void) => {
  const scenario = structuredClone(LOC01_SCENARIO) as unknown as MutableScenario;
  apply(scenario);
  return { label, input: scenario as unknown };
};

test("caminho de erro: entrada ou estado inválido retorna INVALID_STATE sem efeito colateral", () => {
  const cases: { label: string; input: unknown }[] = [
    mutate("scenarioId vazio", (s) => { s.scenarioId = "  "; }),
    mutate("requisito fora do catálogo", (s) => { s.requirementId = "TAREFA-INVALIDA"; }),
    mutate("steps vazio", (s) => { s.steps = []; }),
    mutate("step duplicado", (s) => { s.steps = ["abrir-pasta", "abrir-pasta"]; }),
    mutate("step não textual", (s) => { s.steps = ["abrir-pasta", 7]; }),
    mutate("steps ausente", (s) => { s.steps = null; }),
    mutate("propriedade extra no cenário", (s) => { (s as unknown as Record<string, unknown>).extra = true; }),
    mutate("versão do Cursor não congelada", (s) => { s.cursor.productVersion = "3.25.0"; }),
    mutate("plataformas divergentes", (s) => { s.openagent.platform = "windows"; }),
    mutate("model textual vazio", (s) => { s.openagent.model = ""; }),
    mutate("tabela de efeitos ausente", (s) => { s.cursor.effects = null; }),
    mutate("propriedade extra na superfície", (s) => { s.cursor.extra = true; }),
    {
      label: "passo não mapeado na tabela",
      input: { ...LOC01_SCENARIO, steps: [...LOC01_SCENARIO.steps, "passo-inexistente"] },
    },
    mutate("efeito com nome vazio", (s) => {
      (s.cursor.effects as Record<string, unknown>)["abrir-pasta"] = [
        { kind: "state", name: "", value: true },
      ];
    }),
    {
      label: "texto no lugar da superfície",
      input: { ...LOC01_SCENARIO, openagent: "openagent" } as unknown,
    },
  ];

  for (const test_case of cases) {
    const snapshot = structuredClone(test_case.input);
    const result = driveDualCapture(test_case.input);
    assert.deepEqual(result, { ok: false, code: "INVALID_STATE" }, `caso: ${test_case.label}`);
    assert.deepEqual(
      test_case.input,
      snapshot,
      `entrada mutada no caso: ${test_case.label}`,
    );
  }
});
