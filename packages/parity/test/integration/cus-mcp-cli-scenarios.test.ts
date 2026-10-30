import test from "node:test";
import assert from "node:assert/strict";
import {
  driveEditorScenario,
  formatEditorScenarioReport,
  EDITOR_SCENARIOS,
  EDITOR_REQUIREMENT_IDS,
  editorScenarioCoverage,
} from "../../src/scenarios.js";
import { FROZEN_CURSOR_VERSION, OPENAGENT_VERSION } from "../../src/dual-driver.js";
import type { DualScenario, CaptureEffect } from "../../src/dual-driver.js";
import { CUS01_SCENARIO } from "../../scenarios/cus-01-user-project-rules.js";
import { CUS02_SCENARIO } from "../../scenarios/cus-02-command-skill-plugin-origin.js";
import { CUS03_SCENARIO } from "../../scenarios/cus-03-hook-denies-action.js";
import { MCP01_SCENARIO } from "../../scenarios/mcp-01-mcp-tools-permission.js";
import { CLI01_SCENARIO } from "../../scenarios/cli-01-reuse-workspace-config.js";
import { CLI02_SCENARIO } from "../../scenarios/cli-02-headless-session-in-editor.js";

// Testes co-localizados da task_195: cenários diferenciais de regras
// (customização), MCP e CLI. Efeitos esperados e ordens derivados dos
// critérios canônicos do catálogo (CUS-01..03, MCP-01, CLI-01..02).

const CUSTOMIZATION_SCENARIOS: readonly DualScenario[] = [
  CUS01_SCENARIO,
  CUS02_SCENARIO,
  CUS03_SCENARIO,
  MCP01_SCENARIO,
  CLI01_SCENARIO,
  CLI02_SCENARIO,
];

const EFFECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "CUS-01": ["session-started", "rule-loaded", "rule-loaded", "rules-with-origin-shown"],
  "CUS-02": ["command-invoked", "instruction-applied", "origin-shown"],
  "CUS-03": ["hook-denied", "action-blocked", "hook-justification-shown"],
  "MCP-01": [
    "mcp-server-configured",
    "mcp-tools-listed",
    "permission-requested",
    "tool-executed",
    "tool-result-shown",
  ],
  "CLI-01": [
    "cli-started",
    "provider-reused",
    "mode-reused",
    "rules-reused",
    "mcp-reused",
    "sessions-reused",
  ],
  "CLI-02": [
    "headless-run-finished",
    "editor-opened",
    "session-visible-in-editor",
  ],
};

const scenarioOf = (requirementId: string): DualScenario => {
  const found = CUSTOMIZATION_SCENARIOS.find((s) => s.requirementId === requirementId);
  assert.ok(found, `cenário ausente: ${requirementId}`);
  return found as DualScenario;
};

function effects(
  list: readonly CaptureEffect[],
  name: string,
): readonly CaptureEffect[] {
  return list.filter((effect) => effect.name === name);
}

function expectEffect(
  list: readonly CaptureEffect[],
  name: string,
  expected: Omit<CaptureEffect, "name">,
): void {
  const match = list.find((effect) => effect.name === name);
  assert.ok(match, `efeito ausente: ${name}`);
  assert.equal(
    effects(list, name).length,
    1,
    `efeito não-único: ${name}`,
  );
  assert.deepEqual({ kind: match.kind, value: match.value }, expected);
}

function requireOrdered(list: readonly CaptureEffect[], names: readonly string[]): void {
  let previous = -1;
  for (const name of names) {
    const index = list.findIndex((effect) => effect.name === name);
    assert.ok(
      index > previous,
      `ordem inválida: ${name} (índice ${index}, anterior ${previous})`,
    );
    previous = index;
  }
}

function assertParity(scenario: DualScenario): void {
  const run = driveEditorScenario(scenario);
  assert.ok(run.ok, `cenário inválido: ${scenario.scenarioId}`);
  assert.deepEqual(run.divergences, []);
}

function assertVersioned(scenario: DualScenario): void {
  assert.equal(scenario.cursor.productVersion, FROZEN_CURSOR_VERSION);
  assert.equal(scenario.openagent.productVersion, OPENAGENT_VERSION);
  assert.equal(scenario.cursor.platform, "linux");
  assert.equal(scenario.openagent.platform, "linux");
}

test("CUS-01 carrega regras de usuário e de projeto e mostra a origem de cada uma", () => {
  const run = driveEditorScenario(CUS01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "session-started", {
      kind: "state",
      value: { workspace: "projeto-alfa" },
    });
    const loaded = effects(side.effects, "rule-loaded");
    assert.equal(loaded.length, 2);
    assert.deepEqual(
      loaded.map((effect) => effect.value),
      [
        { source: "user", origin: "~/.openagent/rules.md", rules: 12 },
        { source: "project", origin: ".openagent/rules.md", rules: 8 },
      ],
    );
    expectEffect(side.effects, "rules-with-origin-shown", {
      kind: "ui",
      value: { total: 20, "every-rule-has-origin": true },
    });
    // Ordem: início da sessão < regras do usuário < regras do projeto < origem.
    requireOrdered(side.effects, [
      "session-started",
      "rule-loaded",
      "rules-with-origin-shown",
    ]);
  }
  assertParity(CUS01_SCENARIO);
});

test("CUS-02 aplica a instrução declarada do comando e mostra a origem", () => {
  const run = driveEditorScenario(CUS02_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "command-invoked", {
      kind: "event",
      value: { command: "/revisar-arquivo" },
    });
    expectEffect(side.effects, "instruction-applied", {
      kind: "state",
      value: { instruction: "listar os riscos antes do diff", applied: true },
    });
    expectEffect(side.effects, "origin-shown", {
      kind: "ui",
      value: {
        source: "user-command",
        origin: "~/.openagent/commands/revisar-arquivo.md",
      },
    });
    // Ordem: invocação < instrução aplicada < origem mostrada.
    requireOrdered(side.effects, ["command-invoked", "instruction-applied", "origin-shown"]);
  }
  assertParity(CUS02_SCENARIO);
});

test("CUS-03 hook que nega ação impede a execução e mostra a justificativa", () => {
  const run = driveEditorScenario(CUS03_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "hook-denied", {
      kind: "event",
      value: { hook: "pre-tool-use", tool: "run-command" },
    });
    expectEffect(side.effects, "action-blocked", {
      kind: "state",
      value: { executed: false, code: "HOOK_DENIED" },
    });
    expectEffect(side.effects, "hook-justification-shown", {
      kind: "ui",
      value: {
        message: "Hook local negou: comandos de rede desativados neste repositório.",
      },
    });
    // Ordem: negação do hook < ação impedida < justificativa.
    requireOrdered(side.effects, ["hook-denied", "action-blocked", "hook-justification-shown"]);
  }
  assertParity(CUS03_SCENARIO);
});

test("MCP-01 lista ferramentas e executa a escolhida só depois da permissão", () => {
  const run = driveEditorScenario(MCP01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "mcp-server-configured", {
      kind: "state",
      value: { name: "banco-local", transports: ["stdio", "http"] },
    });
    expectEffect(side.effects, "mcp-tools-listed", {
      kind: "ui",
      value: { server: "banco-local", tools: 4 },
    });
    expectEffect(side.effects, "permission-requested", {
      kind: "ui",
      value: { tool: "consultar-cliente", scope: "mcp-call" },
    });
    expectEffect(side.effects, "tool-executed", {
      kind: "event",
      value: { server: "banco-local", tool: "consultar-cliente", "after-permission": true },
    });
    expectEffect(side.effects, "tool-result-shown", {
      kind: "ui",
      value: { tool: "consultar-cliente", ok: true, result: "1 cliente encontrado" },
    });
    // Ordem: configuração < listagem < permissão < execução < resultado.
    requireOrdered(side.effects, [
      "mcp-server-configured",
      "mcp-tools-listed",
      "permission-requested",
      "tool-executed",
      "tool-result-shown",
    ]);
  }
  assertParity(MCP01_SCENARIO);
});

test("CLI-01 reutiliza provedor, modo, regras, MCP e sessões do workspace", () => {
  const run = driveEditorScenario(CLI01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "cli-started", {
      kind: "event",
      value: { workspace: "projeto-alfa" },
    });
    expectEffect(side.effects, "provider-reused", {
      kind: "ui",
      value: { provider: "local", "same-as-editor": true },
    });
    expectEffect(side.effects, "mode-reused", {
      kind: "ui",
      value: { mode: "agent", "same-as-editor": true },
    });
    expectEffect(side.effects, "rules-reused", {
      kind: "ui",
      value: { count: 20, "same-as-editor": true },
    });
    expectEffect(side.effects, "mcp-reused", {
      kind: "ui",
      value: { servers: 1, "same-as-editor": true },
    });
    expectEffect(side.effects, "sessions-reused", {
      kind: "ui",
      value: { sessions: 3, "same-as-editor": true },
    });
    // Ordem: início < provedor < modo < regras < MCP < sessões.
    requireOrdered(side.effects, [
      "cli-started",
      "provider-reused",
      "mode-reused",
      "rules-reused",
      "mcp-reused",
      "sessions-reused",
    ]);
  }
  assertParity(CLI01_SCENARIO);
});

test("CLI-02 mostra a sessão headless terminada ao abrir o mesmo workspace", () => {
  const run = driveEditorScenario(CLI02_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "headless-run-finished", {
      kind: "state",
      value: { exit: 0, session: "sess-headless-001" },
    });
    expectEffect(side.effects, "editor-opened", {
      kind: "event",
      value: { workspace: "projeto-alfa", same: true },
    });
    expectEffect(side.effects, "session-visible-in-editor", {
      kind: "ui",
      value: { session: "sess-headless-001", visible: true },
    });
    // Ordem: fim da execução headless < editor aberto < sessão visível.
    requireOrdered(side.effects, [
      "headless-run-finished",
      "editor-opened",
      "session-visible-in-editor",
    ]);
  }
  assertParity(CLI02_SCENARIO);
});

test("cenários de regras, MCP e CLI têm nomes de efeito no conjunto declarado", () => {
  for (const scenario of CUSTOMIZATION_SCENARIOS) {
    const expected = EFFECT_NAMES[scenario.requirementId];
    assert.ok(expected, `efeitos não declarados: ${scenario.requirementId}`);
    const run = driveEditorScenario(scenario);
    assert.ok(run.ok);
    for (const side of [run.cursor, run.openagent]) {
      assert.deepEqual(
        side.effects.map((effect) => effect.name),
        [...expected],
        `efeitos divergentes em ${scenario.scenarioId} (${side.product})`,
      );
    }
  }
});

test("cenários de regras, MCP e CLI registram versões e plataforma congeladas", () => {
  for (const scenario of CUSTOMIZATION_SCENARIOS) {
    assertVersioned(scenario);
  }
});

test("cenários de regras, MCP e CLI são determinísticos e repetíveis", () => {
  for (const scenario of CUSTOMIZATION_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("cenários de regras, MCP e CLI não mutam suas entradas", () => {
  for (const scenario of CUSTOMIZATION_SCENARIOS) {
    const before = structuredClone(scenario) as unknown;
    driveEditorScenario(scenario);
    assert.deepEqual(scenario as unknown, before, `entrada mutada: ${scenario.scenarioId}`);
  }
});

test("conjunto completo cobre os 46 requisitos com a única divergência declarada do LOC-01", () => {
  assert.equal(EDITOR_SCENARIOS.length, 46);
  assert.equal(EDITOR_REQUIREMENT_IDS.length, 46);
  const unknown = EDITOR_REQUIREMENT_IDS.filter((id) => !EDITOR_SCENARIOS.some((s) => s.requirementId === id));
  assert.deepEqual(unknown, []);
  const coverage = editorScenarioCoverage();
  assert.equal(coverage.covered.length, 46);
  assert.equal(coverage.required.length, 46);
  for (const requirementId of ["CUS-01", "CUS-02", "CUS-03", "MCP-01", "CLI-01", "CLI-02"]) {
    assert.ok(
      EDITOR_SCENARIOS.some((s) => s.requirementId === requirementId),
      `requisito ausente do conjunto: ${requirementId}`,
    );
  }
  // A única divergência declarada do conjunto completo permanece a
  // identidade de pacote do LOC-01 (so-no-openagent: ui:package-identity).
  const locRun = driveEditorScenario(
    EDITOR_SCENARIOS.find((s) => s.requirementId === "LOC-01") as DualScenario,
  );
  assert.ok(locRun.ok);
  assert.deepEqual(locRun.divergences, ["so-no-openagent: ui:package-identity"]);
});

test("relatório registra os cenários de regras, MCP e CLI por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["CUS-01", "CUS-02", "CUS-03", "MCP-01", "CLI-01", "CLI-02"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
    const scenario = scenarioOf(requirementId);
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 46/46"));
});
