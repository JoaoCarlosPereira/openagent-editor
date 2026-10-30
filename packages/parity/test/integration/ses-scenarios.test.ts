import test from "node:test";
import assert from "node:assert/strict";
import {
  driveEditorScenario,
  formatEditorScenarioReport,
  EDITOR_SCENARIOS,
  EDITOR_REQUIREMENT_IDS,
  editorScenarioCoverage,
  runAllEditorScenarios,
} from "../../src/scenarios.js";
import { FROZEN_CURSOR_VERSION, OPENAGENT_VERSION } from "../../src/dual-driver.js";
import type { DualScenario, CaptureEffect } from "../../src/dual-driver.js";
import { SES01_SCENARIO } from "../../scenarios/ses-01-reopen-sessions-on-restart.js";
import { SES02_SCENARIO } from "../../scenarios/ses-02-export-session-text.js";
import { SES03_SCENARIO } from "../../scenarios/ses-03-checkpoint-restore-conflict.js";
import { SES04_SCENARIO } from "../../scenarios/ses-04-worktree-isolation.js";
import { SES05_SCENARIO } from "../../scenarios/ses-05-conversation-search.js";
import { SES06_SCENARIO } from "../../scenarios/ses-06-side-conversation-preserves-main.js";
import { SES07_SCENARIO } from "../../scenarios/ses-07-session-delete.js";

// Testes co-localizados da task_196: cenários diferenciais de sessões.
// Efeitos esperados e ordens derivados dos critérios canônicos do catálogo
// (SES-01..SES-07).

const SESSION_SCENARIOS: readonly DualScenario[] = [
  SES01_SCENARIO,
  SES02_SCENARIO,
  SES03_SCENARIO,
  SES04_SCENARIO,
  SES05_SCENARIO,
  SES06_SCENARIO,
  SES07_SCENARIO,
];

const EFFECT_NAMES = {
  "SES-01": [
    "editor-restarted",
    "session-reopened",
    "session-content-restored",
  ],
  "SES-02": [
    "session-export-requested",
    "export-file-written",
    "export-confirmed",
  ],
  "SES-03": [
    "checkpoint-selected",
    "marked-files-reverted",
    "restore-conflict-shown",
  ],
  "SES-04": [
    "isolated-work-requested",
    "worktree-created",
    "original-preserved",
  ],
  "SES-05": [
    "conversation-search-performed",
    "conversation-matches-listed",
  ],
  "SES-06": [
    "side-conversation-opened",
    "main-conversation-preserved",
    "returned-to-main",
  ],
  "SES-07": [
    "session-delete-confirmed",
    "local-messages-removed",
    "other-sessions-unaffected",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const scenarioOf = (requirementId: string): DualScenario => {
  const found = SESSION_SCENARIOS.find((s) => s.requirementId === requirementId);
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

test("SES-01 reinício do editor reabre as sessões do workspace com o conteúdo por sessão", () => {
  const run = driveEditorScenario(SES01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "editor-restarted", {
      kind: "state",
      value: { workspace: "projeto-alfa" },
    });
    expectEffect(side.effects, "session-reopened", {
      kind: "event",
      value: { workspace: "projeto-alfa", sessions: 2 },
    });
    expectEffect(side.effects, "session-content-restored", {
      kind: "state",
      value: {
        session: "sess-alfa-001",
        mode: "agent",
        messages: 6,
        toolInvocations: 3,
        attachments: 2,
        allStillExists: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-01"]);
  }
  assertParity(SES01_SCENARIO);
});

test("SES-02 exportar sessão grava arquivo de texto com as mensagens daquela sessão", () => {
  const run = driveEditorScenario(SES02_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "session-export-requested", {
      kind: "state",
      value: { session: "sess-alfa-001" },
    });
    expectEffect(side.effects, "export-file-written", {
      kind: "state",
      value: {
        session: "sess-alfa-001",
        file: "sess-alfa-001.txt",
        format: "text",
        messages: 6,
        allMessagesIncluded: true,
      },
    });
    expectEffect(side.effects, "export-confirmed", {
      kind: "ui",
      value: { session: "sess-alfa-001", file: "sess-alfa-001.txt", shown: true },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-02"]);
  }
  assertParity(SES02_SCENARIO);
});

test("SES-03 restaurar checkpoint reverte só os arquivos marcados e reporta conflito sem sobrescrever", () => {
  const run = driveEditorScenario(SES03_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "checkpoint-selected", {
      kind: "state",
      value: { checkpoint: "ckpt-runa-0004", run: "runa-0004", markedFiles: 3 },
    });
    expectEffect(side.effects, "marked-files-reverted", {
      kind: "state",
      value: {
        checkpoint: "ckpt-runa-0004",
        files: ["src/servico.ts", "src/regras.ts"],
        count: 2,
        onlyRunChanges: true,
      },
    });
    expectEffect(side.effects, "restore-conflict-shown", {
      kind: "ui",
      value: {
        checkpoint: "ckpt-runa-0004",
        file: "src/indice.ts",
        conflict: "ALTERADO_APOS_A_EXECUCAO",
        overwritten: false,
        versionsShown: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-03"]);
  }
  assertParity(SES03_SCENARIO);
});

test("SES-04 trabalho isolado usa worktree local e preserva o workspace original até a aplicação escolhida", () => {
  const run = driveEditorScenario(SES04_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "isolated-work-requested", {
      kind: "state",
      value: { workspace: "projeto-alfa" },
    });
    expectEffect(side.effects, "worktree-created", {
      kind: "state",
      value: { worktree: "worktrees/iso-001", base: "main", local: true },
    });
    expectEffect(side.effects, "original-preserved", {
      kind: "state",
      value: {
        workspace: "projeto-alfa",
        localChanges: 0,
        preserved: true,
        applyOnlyOnChoice: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-04"]);
  }
  assertParity(SES04_SCENARIO);
});

test("SES-05 busca na conversa lista as mensagens da sessão local que contêm o texto", () => {
  const run = driveEditorScenario(SES05_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "conversation-search-performed", {
      kind: "state",
      value: { session: "sess-alfa-001", query: "anexo" },
    });
    expectEffect(side.effects, "conversation-matches-listed", {
      kind: "ui",
      value: {
        session: "sess-alfa-001",
        query: "anexo",
        matches: ["msg-001", "msg-004", "msg-010"],
        count: 3,
        source: "sessao-local",
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-05"]);
  }
  assertParity(SES05_SCENARIO);
});

test("SES-06 conversa lateral conserva as mensagens da conversa principal", () => {
  const run = driveEditorScenario(SES06_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "side-conversation-opened", {
      kind: "event",
      value: { parent: "sess-alfa-001", side: "sess-alfa-002", from: "msg-006" },
    });
    expectEffect(side.effects, "main-conversation-preserved", {
      kind: "state",
      value: { session: "sess-alfa-001", messages: 6, unchanged: true },
    });
    expectEffect(side.effects, "returned-to-main", {
      kind: "ui",
      value: { session: "sess-alfa-001", messages: 6 },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-06"]);
  }
  assertParity(SES06_SCENARIO);
});

test("SES-07 apagar sessão remove as mensagens locais dela e conserva as demais sessões", () => {
  const run = driveEditorScenario(SES07_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "session-delete-confirmed", {
      kind: "state",
      value: { session: "sess-alfa-002", workspace: "projeto-alfa" },
    });
    expectEffect(side.effects, "local-messages-removed", {
      kind: "state",
      value: { session: "sess-alfa-002", removed: 4, remaining: 0 },
    });
    expectEffect(side.effects, "other-sessions-unaffected", {
      kind: "state",
      value: { session: "sess-alfa-001", messages: 6 },
    });
    requireOrdered(side.effects, EFFECT_NAMES["SES-07"]);
  }
  assertParity(SES07_SCENARIO);
});

test("os nomes de efeito declarados coincidem com a sequência capturada de cada cenário de sessões", () => {
  for (const scenario of SESSION_SCENARIOS) {
    const run = driveEditorScenario(scenario);
    assert.ok(run.ok, `cenário inválido: ${scenario.scenarioId}`);
    if (!run.ok) continue;
    const expected: readonly string[] | undefined =
      (EFFECT_NAMES as Readonly<Record<string, readonly string[]>>)[
        scenario.requirementId
      ];
    assert.ok(expected, `efeitos não declarados: ${scenario.requirementId}`);
    for (const side of [run.cursor, run.openagent]) {
      const names = side.effects.map((effect) => effect.name);
      assert.deepEqual(
        names.filter((name) => expected.includes(name)),
        expected,
        `nomes de efeito divergem em ${scenario.scenarioId}`,
      );
    }
  }
});

test("cada cenário de sessões usa a versão congelada do Cursor e a versão corrente do OpenAgent", () => {
  for (const scenario of SESSION_SCENARIOS) {
    assertVersioned(scenario);
  }
});

test("cenários de sessões são determinísticos entre execuções do driver", () => {
  for (const scenario of SESSION_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("driveEditorScenario não muta as entradas dos cenários de sessões", () => {
  for (const scenario of SESSION_SCENARIOS) {
    const before = JSON.parse(JSON.stringify(scenario));
    driveEditorScenario(scenario);
    assert.deepEqual(
      scenario as unknown,
      before,
      `entrada mutada: ${scenario.scenarioId}`,
    );
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

test("relatório registra os cenários de sessões por requisito", () => {
  const report = formatEditorScenarioReport();
  for (const requirementId of ["SES-01", "SES-02", "SES-03", "SES-04", "SES-05", "SES-06", "SES-07"]) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
    const scenario = scenarioOf(requirementId);
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 46/46"));
});
