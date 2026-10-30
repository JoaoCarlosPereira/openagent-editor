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
import { CTX01_SCENARIO } from "../../scenarios/ctx-01-attach-context-summary.js";
import { CTX02_SCENARIO } from "../../scenarios/ctx-02-incremental-index.js";
import { CTX03_SCENARIO } from "../../scenarios/ctx-03-excluded-path-omitted.js";
import { CTX04_SCENARIO } from "../../scenarios/ctx-04-index-cleanup.js";
import { PRV01_SCENARIO } from "../../scenarios/prv-01-explicit-external-send.js";
import { PRV02_SCENARIO } from "../../scenarios/prv-02-redacted-tool-log.js";

const CTX_PRIVACY_SCENARIOS: readonly DualScenario[] = [
  CTX01_SCENARIO,
  CTX02_SCENARIO,
  CTX03_SCENARIO,
  CTX04_SCENARIO,
  PRV01_SCENARIO,
  PRV02_SCENARIO,
];

const CTX_PRIVACY_EFFECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "CTX-01": [
    "selection-attached",
    "file-attached",
    "folder-attached",
    "symbol-attached",
    "context-summary-before-send",
  ],
  "CTX-02": ["file-saved", "index-updated-incrementally", "search-finds-new-text"],
  "CTX-03": [
    "exclusion-rule-active",
    "path-omitted-from-index",
    "path-omitted-from-auto-context",
    "path-omitted-from-agent-search",
  ],
  "CTX-04": ["cleanup-requested", "cleanup-scope-and-size-shown", "workspace-local-data-cleared"],
  "PRV-01": [
    "context-assembled-locally",
    "explicit-send-action",
    "context-sent-to-external-api",
    "excluded-path-never-sent",
  ],
  "PRV-02": [
    "tool-action-logged",
    "log-written",
    "credential-omitted",
    "excluded-file-content-omitted",
    "raw-model-body-omitted",
  ],
};

const ctxPrivacyScenario = (requirementId: string): DualScenario => {
  const found = CTX_PRIVACY_SCENARIOS.find((s) => s.requirementId === requirementId);
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

test("CTX-01: anexos listam cada fonte e mostram tokens e teto antes do envio", () => {
  const before = structuredClone(CTX01_SCENARIO) as unknown;
  const result = driveEditorScenario(CTX01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "CTX-01");
  assert.equal(result.scenarioId, "ctx-01-attach-context-summary");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    assert.equal(side.productVersion, side.product === "cursor" ? FROZEN_CURSOR_VERSION : OPENAGENT_VERSION);
    for (const name of CTX_PRIVACY_EFFECT_NAMES["CTX-01"] ?? []) {
      assert.ok(side.effects.some((effect) => effect.name === name), `efeito ausente: ${name}`);
    }
    expectEffect(side.effects, "selection-attached", {
      kind: "ui",
      value: { source: "selection", target: "src/index.ts#L12-L18" },
    });
    expectEffect(side.effects, "file-attached", {
      kind: "ui",
      value: { source: "file", target: "src/service.ts" },
    });
    expectEffect(side.effects, "folder-attached", {
      kind: "ui",
      value: { source: "folder", target: "src/lib" },
    });
    expectEffect(side.effects, "symbol-attached", {
      kind: "ui",
      value: { source: "symbol", target: "function: authorize" },
    });
    expectEffect(side.effects, "context-summary-before-send", {
      kind: "ui",
      value: { sources: 4, tokens: 1855, ceiling: 200000, "visible-before-send": true },
    });
    // Ordem: o resumo (fontes, tokens e teto) vem depois de todos os anexos.
    const order = side.effects.map((effect) => effect.name);
    const summary = order.indexOf("context-summary-before-send");
    for (const name of ["selection-attached", "file-attached", "folder-attached", "symbol-attached"]) {
      assert.ok(order.indexOf(name) < summary, `anexo ${name} listado após o resumo`);
    }
  }
  assert.deepEqual(CTX01_SCENARIO as unknown, before, "entrada CTX-01 não deve ser mutada");
});

test("CTX-02: salvar arquivo indexado atualiza busca incremental sem reconstruir o índice inteiro", () => {
  const result = driveEditorScenario(ctxPrivacyScenario("CTX-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "file-saved", {
      kind: "event",
      value: { file: "src/service.ts", indexed: true },
    });
    expectEffect(side.effects, "index-updated-incrementally", {
      kind: "state",
      value: { mode: "incremental", files: ["src/service.ts"], "full-rebuild": false },
    });
    expectEffect(side.effects, "search-finds-new-text", {
      kind: "ui",
      value: { query: "autorizacaoRenovada", matches: 1, "without-full-rebuild": true },
    });
    // Ordem: salvar < atualização incremental < busca achando o texto novo.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("file-saved") < order.indexOf("index-updated-incrementally"),
      "atualização incremental antes de salvar",
    );
    assert.ok(
      order.indexOf("index-updated-incrementally") < order.indexOf("search-finds-new-text"),
      "busca antes da atualização incremental",
    );
  }
});

test("CTX-03: caminho excluído fica omitido do índice, do contexto automático e da busca do agente", () => {
  const result = driveEditorScenario(ctxPrivacyScenario("CTX-03"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "exclusion-rule-active", {
      kind: "state",
      value: { pattern: "secrets/**" },
    });
    expectEffect(side.effects, "path-omitted-from-index", {
      kind: "state",
      value: { path: "secrets/env.ts", indexed: false },
    });
    expectEffect(side.effects, "path-omitted-from-auto-context", {
      kind: "ui",
      value: { path: "secrets/env.ts", included: false },
    });
    expectEffect(side.effects, "path-omitted-from-agent-search", {
      kind: "ui",
      value: { query: "chaveApi", matches: 0 },
    });
  }
});

test("CTX-04: limpeza mostra escopo e tamanho e apaga os dados locais daquele workspace", () => {
  const result = driveEditorScenario(ctxPrivacyScenario("CTX-04"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "cleanup-requested", {
      kind: "event",
      value: { action: "clear-index" },
    });
    expectEffect(side.effects, "cleanup-scope-and-size-shown", {
      kind: "ui",
      value: { scope: "workspace", workspace: "projeto-alfa", "size-bytes": 4718592 },
    });
    expectEffect(side.effects, "workspace-local-data-cleared", {
      kind: "state",
      value: { scope: "workspace", cleared: true, "remaining-bytes": 0 },
    });
    // Ordem: escopo/tamanho visíveis antes de apagar os dados.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("cleanup-scope-and-size-shown") < order.indexOf("workspace-local-data-cleared"),
      "dados apagados antes de mostrar escopo e tamanho",
    );
  }
});

test("PRV-01: envio à API externa só depois de ação explícita e nunca envia caminho excluído", () => {
  const result = driveEditorScenario(ctxPrivacyScenario("PRV-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "context-assembled-locally", {
      kind: "state",
      value: { destination: "local", sent: false },
    });
    expectEffect(side.effects, "explicit-send-action", {
      kind: "event",
      value: { action: "enviar", explicit: true },
    });
    expectEffect(side.effects, "context-sent-to-external-api", {
      kind: "event",
      value: { destination: "external-api", "after-explicit-action": true },
    });
    expectEffect(side.effects, "excluded-path-never-sent", {
      kind: "state",
      value: { path: "secrets/env.ts", sent: false },
    });
    // Ordem: ação explícita de envio vem antes do envio à API externa.
    const order = side.effects.map((effect) => effect.name);
    assert.ok(
      order.indexOf("explicit-send-action") < order.indexOf("context-sent-to-external-api"),
      "contexto enviado sem ação explícita de envio",
    );
  }
});

test("PRV-02: log registra a ação da ferramenta e omite credencial, conteúdo excluído e corpo bruto", () => {
  const result = driveEditorScenario(ctxPrivacyScenario("PRV-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "tool-action-logged", {
      kind: "event",
      value: { action: "file-edit", target: "src/service.ts", logged: true },
    });
    expectEffect(side.effects, "log-written", {
      kind: "state",
      value: { channel: "padrão", entries: 1 },
    });
    expectEffect(side.effects, "credential-omitted", {
      kind: "state",
      value: { "credential-in-log": false },
    });
    expectEffect(side.effects, "excluded-file-content-omitted", {
      kind: "state",
      value: { path: "secrets/env.ts", "content-in-log": false },
    });
    expectEffect(side.effects, "raw-model-body-omitted", {
      kind: "state",
      value: { "raw-response-body-in-log": false },
    });
  }
});

test("cenários de contexto e privacidade são determinísticos e repetíveis", () => {
  for (const scenario of CTX_PRIVACY_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("conjunto completo cobre os 24 requisitos com a única divergência declarada do LOC-01", () => {
  assert.equal(EDITOR_SCENARIOS.length, 24);
  assert.equal(EDITOR_SCENARIOS.length, EDITOR_REQUIREMENT_IDS.length);
  assert.deepEqual(
    EDITOR_SCENARIOS.map((scenario) => scenario.requirementId).join(","),
    EDITOR_REQUIREMENT_IDS.join(","),
  );

  const coverage = editorScenarioCoverage();
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.covered.length, 24);

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

test("relatório registra os cenários de contexto e privacidade por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["CTX-01", "CTX-02", "CTX-03", "CTX-04", "PRV-01", "PRV-02"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
  }
  for (const scenario of CTX_PRIVACY_SCENARIOS) {
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 24/24"));
});
