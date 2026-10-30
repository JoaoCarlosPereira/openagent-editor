import test from "node:test";
import assert from "node:assert/strict";
import { driveEditorScenario, formatEditorScenarioReport } from "../../src/scenarios.js";
import { FROZEN_CURSOR_VERSION, OPENAGENT_VERSION } from "../../src/dual-driver.js";
import type { DualScenario, CaptureEffect } from "../../src/dual-driver.js";
import { TAB01_SCENARIO } from "../../scenarios/tab-01-suggestion-controls.js";
import { TAB02_SCENARIO } from "../../scenarios/tab-02-next-point-jump.js";
import { TAB03_SCENARIO } from "../../scenarios/tab-03-cross-file-review.js";
import { INL01_SCENARIO } from "../../scenarios/inl-01-inline-edit-diff.js";
import { INL02_SCENARIO } from "../../scenarios/inl-02-whole-file-restore.js";
import { AUT01_SCENARIO } from "../../scenarios/aut-01-authorized-browser.js";
import { AUT02_SCENARIO } from "../../scenarios/aut-02-computer-action-at-a-time.js";
import { DES01_SCENARIO } from "../../scenarios/des-01-element-code-attach.js";
import { CAN01_SCENARIO } from "../../scenarios/can-01-canvas-persistent-panel.js";

const DIFFERENTIAL_SCENARIOS: readonly DualScenario[] = [
  TAB01_SCENARIO,
  TAB02_SCENARIO,
  TAB03_SCENARIO,
  INL01_SCENARIO,
  INL02_SCENARIO,
  AUT01_SCENARIO,
  AUT02_SCENARIO,
  DES01_SCENARIO,
  CAN01_SCENARIO,
];

const EFFECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  "TAB-01": [
    "suggestion-offered",
    "continuation-suggested",
    "suggestion-controls",
    "suggestion-cancelled",
  ],
  "TAB-02": ["suggestion-accepted", "next-point-indicated", "keyboard-jump"],
  "TAB-03": ["cross-file-change", "affected-path-shown", "review-required", "applied-after-review"],
  "INL-01": ["inline-edit-requested", "diff-shown-in-editor", "inline-edit-controls"],
  "INL-02": ["whole-file-edit-requested", "whole-file-preview-shown", "edit-rejected", "previous-content-restored"],
  "AUT-01": ["browser-permission-granted", "url-opened", "authorized-interaction-executed", "screenshot-shown", "console-shown"],
  "AUT-02": ["computer-permission-granted", "single-action-executed", "action-result-shown", "unauthorized-action-denied"],
  "DES-01": ["drawing-mode-active", "element-selected", "element-context-attached"],
  "CAN-01": ["canvas-opened", "canvas-displayed", "response-finished", "canvas-still-visible"],
};

const differentialScenario = (requirementId: string): DualScenario => {
  const found = DIFFERENTIAL_SCENARIOS.find((s) => s.requirementId === requirementId);
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

function requireOrdered(side: { effects: readonly CaptureEffect[] }, order: readonly string[]): void {
  for (let i = 0; i < order.length - 1; i++) {
    const previous = order[i];
    const next = order[i + 1];
    if (previous === undefined || next === undefined) return;
    assert.ok(
      side.effects.map((effect) => effect.name).indexOf(previous) <
        side.effects.map((effect) => effect.name).indexOf(next),
      `ordem inválida: ${previous} deve preceder ${next}`,
    );
  }
}

test("TAB-01: digitar com Tab ativo oferece continuação de linha/bloco com aceitar, recusar e cancelar", () => {
  const before = structuredClone(TAB01_SCENARIO) as unknown;
  const result = driveEditorScenario(TAB01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.requirementId, "TAB-01");
  assert.equal(result.scenarioId, "tab-01-suggestion-controls");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    assert.equal(side.productVersion, side.product === "cursor" ? FROZEN_CURSOR_VERSION : OPENAGENT_VERSION);
    for (const name of EFFECT_NAMES["TAB-01"] ?? []) {
      assert.ok(side.effects.some((effect) => effect.name === name), `efeito ausente: ${name}`);
    }
    const continuations = side.effects.filter((effect) => effect.name === "continuation-suggested");
    assert.deepEqual(continuations, [
      { kind: "ui", name: "continuation-suggested", value: { scope: "line", location: "src/service.ts:12", "inserted-count": 1 } },
      { kind: "ui", name: "continuation-suggested", value: { scope: "block", location: "src/service.ts:18", "inserted-count": 4 } },
    ]);
    expectEffect(side.effects, "suggestion-controls", {
      kind: "ui",
      value: { accept: true, reject: true, cancel: true },
    });
    expectEffect(side.effects, "suggestion-cancelled", {
      kind: "state",
      value: { during: "generation", "partially-applied": false },
    });
    // Ordem: continuação oferecida < controles < cancelamento sem aplicação parcial.
    requireOrdered(side, ["suggestion-offered", "continuation-suggested", "suggestion-controls", "suggestion-cancelled"]);
  }
  assert.deepEqual(TAB01_SCENARIO as unknown, before, "entrada TAB-01 não deve ser mutada");
});

test("TAB-02: aceite de sugestão com continuação indica o próximo ponto e permite salto por teclado", () => {
  const result = driveEditorScenario(differentialScenario("TAB-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "suggestion-accepted", {
      kind: "event",
      value: { "has-continuation": true, "instances-remaining": 2 },
    });
    expectEffect(side.effects, "next-point-indicated", {
      kind: "ui",
      value: { count: 2, location: "src/service.ts:18", "awaiting-jump": true },
    });
    expectEffect(side.effects, "keyboard-jump", {
      kind: "state",
      value: { key: "Tab", location: "src/service.ts:18", "cursor-moved": true },
    });
    // Ordem: aceite < indicação do próximo ponto < salto por teclado.
    requireOrdered(side, ["suggestion-accepted", "next-point-indicated", "keyboard-jump"]);
  }
});

test("TAB-03: mudança em outro arquivo mostra o caminho e aplica só depois de revisão", () => {
  const result = driveEditorScenario(differentialScenario("TAB-03"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "cross-file-change", {
      kind: "diff",
      value: { "current-file": "src/service.ts", "affected-files": ["src/lib/handler.ts"] },
    });
    expectEffect(side.effects, "review-required", {
      kind: "state",
      value: { required: true, "applied-before-review": false },
    });
    // Ordem: caminho exibido < revisão < aplicação.
    requireOrdered(side, ["affected-path-shown", "review-required", "applied-after-review"]);
  }
});

test("INL-01: Inline Edit na seleção mostra diff no editor com aceitar, rejeitar e refinar", () => {
  const result = driveEditorScenario(differentialScenario("INL-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "inline-edit-requested", {
      kind: "event",
      value: { target: "selection", range: "src/index.ts#L12-L18" },
    });
    expectEffect(side.effects, "diff-shown-in-editor", {
      kind: "diff",
      value: { file: "src/index.ts", "in-editor": true, added: 5, removed: 3 },
    });
    expectEffect(side.effects, "inline-edit-controls", {
      kind: "ui",
      value: { accept: true, reject: true, refine: true },
    });
    // Ordem: pedido < diff no editor < controles de revisão.
    requireOrdered(side, ["inline-edit-requested", "diff-shown-in-editor", "inline-edit-controls"]);
  }
});

test("INL-02: edição do arquivo inteiro permite rejeitar e restaurar o conteúdo anterior", () => {
  const result = driveEditorScenario(differentialScenario("INL-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "whole-file-edit-requested", {
      kind: "event",
      value: { target: "src/service.ts", scope: "whole-file" },
    });
    expectEffect(side.effects, "previous-content-restored", {
      kind: "diff",
      value: { file: "src/service.ts", restored: true, "before-request": true },
    });
    // Ordem: rejeição < restauração do conteúdo anterior.
    requireOrdered(side, ["edit-rejected", "previous-content-restored"]);
  }
});

test("AUT-01: navegador autorizado abre a URL, executa a interação e mostra captura e console", () => {
  const result = driveEditorScenario(differentialScenario("AUT-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "browser-permission-granted", {
      kind: "state",
      value: { tool: "browser", authorized: true, scope: "session" },
    });
    expectEffect(side.effects, "url-opened", {
      kind: "ui",
      value: { url: "http://localhost:3000", visible: true },
    });
    expectEffect(side.effects, "screenshot-shown", {
      kind: "ui",
      value: { capture: true, format: "png", visible: true },
    });
    expectEffect(side.effects, "console-shown", {
      kind: "ui",
      value: { messages: 3, visible: true },
    });
    // Ordem: autorização < URL < interação autorizada < captura < console.
    requireOrdered(side, [
      "browser-permission-granted",
      "url-opened",
      "authorized-interaction-executed",
      "screenshot-shown",
      "console-shown",
    ]);
  }
});

test("AUT-02: uso do computador executa uma ação por vez, nomeada na permissão, e mostra o resultado", () => {
  const result = driveEditorScenario(differentialScenario("AUT-02"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "computer-permission-granted", {
      kind: "state",
      value: { tool: "computer-use", authorized: true, "named-action": "screenshot" },
    });
    expectEffect(side.effects, "single-action-executed", {
      kind: "event",
      value: { action: "screenshot", "one-at-a-time": true },
    });
    expectEffect(side.effects, "unauthorized-action-denied", {
      kind: "error",
      value: { action: "run-shell", code: "PERMISSION_DENIED", granted: "screenshot" },
    });
    // Ordem: autorização com ação nomeada < ação única < resultado < recusa.
    requireOrdered(side, ["computer-permission-granted", "single-action-executed", "action-result-shown", "unauthorized-action-denied"]);
  }
});

test("DES-01: elemento selecionado em modo desenho anexa identificação e trecho à mensagem seguinte", () => {
  const result = driveEditorScenario(differentialScenario("DES-01"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "drawing-mode-active", {
      kind: "ui",
      value: { mode: "drawing", surface: "browser" },
    });
    expectEffect(side.effects, "element-context-attached", {
      kind: "ui",
      value: {
        selector: "button#submit",
        snippet: "web/app.tsx#L40-L46",
        "attach-to": "next-message",
        "before-send": true,
      },
    });
    // Ordem: modo de desenho < seleção do elemento < anexo antes do envio.
    requireOrdered(side, ["drawing-mode-active", "element-selected", "element-context-attached"]);
  }
});

test("CAN-01: canvas aberto pelo agente aparece no painel e persiste após o fim da resposta", () => {
  const before = structuredClone(CAN01_SCENARIO) as unknown;
  const result = driveEditorScenario(CAN01_SCENARIO);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.requirementId, "CAN-01");
  assert.deepEqual(result.divergences, []);

  for (const side of [result.cursor, result.openagent]) {
    expectEffect(side.effects, "canvas-opened", {
      kind: "event",
      value: { by: "agent", title: "Comparativo de migração" },
    });
    expectEffect(side.effects, "canvas-displayed", {
      kind: "ui",
      value: { panel: "canvas", visible: true },
    });
    expectEffect(side.effects, "canvas-still-visible", {
      kind: "ui",
      value: { panel: "canvas", visible: true, "after-response": true },
    });
    // Ordem: abertura < exibição < fim da resposta < persistência.
    requireOrdered(side, ["canvas-opened", "canvas-displayed", "response-finished", "canvas-still-visible"]);
  }
  assert.deepEqual(CAN01_SCENARIO as unknown, before, "entrada CAN-01 não deve ser mutada");
});

test("cenários diferenciais de Tab, Inline, navegador, desenho e canvas são determinísticos e repetíveis", () => {
  for (const scenario of DIFFERENTIAL_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("relatório registra os cenários diferenciais por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["TAB-01", "TAB-02", "TAB-03", "INL-01", "INL-02", "AUT-01", "AUT-02", "DES-01", "CAN-01"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
  }
  for (const scenario of DIFFERENTIAL_SCENARIOS) {
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 33/33"));
});
