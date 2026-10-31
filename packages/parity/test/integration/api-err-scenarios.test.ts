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
import { API01_SCENARIO } from "../../scenarios/api-01-provider-test-vault.js";
import { API02_SCENARIO } from "../../scenarios/api-02-provider-failure-preserves-diff.js";
import { API03_SCENARIO } from "../../scenarios/api-03-context-ceiling-default.js";
import { ERR01_SCENARIO } from "../../scenarios/err-01-file-changed-conflict-versions.js";
import { ERR02_SCENARIO } from "../../scenarios/err-02-path-out-of-scope.js";
import { ERR03_SCENARIO } from "../../scenarios/err-03-incomplete-stream-retry.js";
import { ERR04_SCENARIO } from "../../scenarios/err-04-index-removes-recently-excluded.js";

// Testes co-localizados da task_197: cenários diferenciais de provedor e
// casos de borda. Efeitos esperados e ordens derivados dos critérios
// canônicos do catálogo (API-01..API-03, ERR-01..ERR-04).

const PROVIDER_ERROR_SCENARIOS: readonly DualScenario[] = [
  API01_SCENARIO,
  API02_SCENARIO,
  API03_SCENARIO,
  ERR01_SCENARIO,
  ERR02_SCENARIO,
  ERR03_SCENARIO,
  ERR04_SCENARIO,
];

const EFFECT_NAMES = {
  "API-01": [
    "provider-credentials-informed",
    "connection-tested",
    "capabilities-detected",
    "credential-stored-system-vault",
  ],
  "API-02": [
    "previous-diff-produced",
    "provider-failure-received",
    "failure-cause-displayed",
    "typed-text-preserved",
    "previous-diff-preserved",
  ],
  "API-03": [
    "message-submitted-without-ceiling",
    "context-ceiling-displayed",
    "message-submitted-with-saved-ceiling",
    "saved-context-ceiling-displayed",
  ],
  "ERR-01": [
    "patch-generated",
    "file-changed-externally",
    "direct-apply-blocked",
    "both-versions-shown",
  ],
  "ERR-02": [
    "out-of-scope-requested",
    "operation-denied",
    "message-recorded",
  ],
  "ERR-03": [
    "stream-partial-received",
    "stream-connection-dropped",
    "response-marked-incomplete",
    "partial-record-preserved",
    "retry-issued",
  ],
  "ERR-04": [
    "chunks-indexed",
    "path-recently-excluded",
    "stale-chunk-removed",
    "next-search-omits-excluded",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const scenarioOf = (requirementId: string): DualScenario => {
  const found = PROVIDER_ERROR_SCENARIOS.find(
    (s) => s.requirementId === requirementId,
  );
  assert.ok(found, `cenário ausente: ${requirementId}`);
  return found as DualScenario;
};

function effects(
  list: readonly CaptureEffect[],
  name: string,
): CaptureEffect[] {
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

test("API-01 informar endpoint, modelo e credencial testa a conexão, mostra capacidades e guarda a credencial no cofre", () => {
  const run = driveEditorScenario(API01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "provider-credentials-informed", {
      kind: "state",
      value: {
        endpoint: "http://localhost:8455/v1",
        model: "modelo-local",
        credentialLabel: "chave-do-provedor",
      },
    });
    expectEffect(side.effects, "connection-tested", {
      kind: "ui",
      value: {
        endpoint: "http://localhost:8455/v1",
        model: "modelo-local",
        ok: true,
      },
    });
    expectEffect(side.effects, "capabilities-detected", {
      kind: "ui",
      value: {
        model: "modelo-local",
        capabilities: ["chat", "edit", "apply"],
        listed: true,
      },
    });
    expectEffect(side.effects, "credential-stored-system-vault", {
      kind: "state",
      value: {
        vault: "sistema",
        secretRef: "api-01-chave-do-provedor",
        plaintextSaved: false,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["API-01"]);
  }
  assertParity(API01_SCENARIO);
});

test("API-02 falha do provedor exibe a causa e conserva o texto digitado e o diff já produzido", () => {
  const run = driveEditorScenario(API02_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "previous-diff-produced", {
      kind: "diff",
      value: { file: "src/servico.ts", additions: 12, deletions: 4 },
    });
    expectEffect(side.effects, "provider-failure-received", {
      kind: "error",
      value: { provider: "cliproxy-v8.0.45", cause: "quota_exceeded" },
    });
    expectEffect(side.effects, "failure-cause-displayed", {
      kind: "ui",
      value: {
        cause: "quota_exceeded",
        text: "Recusa do provedor por taxa excedida.",
      },
    });
    expectEffect(side.effects, "typed-text-preserved", {
      kind: "state",
      value: {
        message: "Refatorar o serviço de clientes",
        preserved: true,
      },
    });
    expectEffect(side.effects, "previous-diff-preserved", {
      kind: "state",
      value: {
        file: "src/servico.ts",
        additions: 12,
        deletions: 4,
        unchanged: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["API-02"]);
  }
  assertParity(API02_SCENARIO);
});

test("API-03 envio de mensagem exibe o teto de contexto, com padrão 200000 quando não gravado", () => {
  const run = driveEditorScenario(API03_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "message-submitted-without-ceiling", {
      kind: "state",
      value: { session: "sess-alfa-001", ceilingSaved: null },
    });
    expectEffect(side.effects, "context-ceiling-displayed", {
      kind: "ui",
      value: { tokens: 200000, source: "padrao" },
    });
    expectEffect(side.effects, "message-submitted-with-saved-ceiling", {
      kind: "state",
      value: { session: "sess-alfa-001", ceilingSaved: 100000 },
    });
    expectEffect(side.effects, "saved-context-ceiling-displayed", {
      kind: "ui",
      value: { tokens: 100000, source: "gravado" },
    });
    requireOrdered(side.effects, EFFECT_NAMES["API-03"]);
  }
  assertParity(API03_SCENARIO);
});

test("ERR-01 arquivo mudado entre geração e aplicação bloqueia a aplicação direta e mostra as duas versões", () => {
  const run = driveEditorScenario(ERR01_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "patch-generated", {
      kind: "diff",
      value: { file: "src/servico.ts", changes: 8, baseHash: "a1b2c3" },
    });
    expectEffect(side.effects, "file-changed-externally", {
      kind: "state",
      value: { file: "src/servico.ts", changedAfterGeneration: true, diskHash: "d4e5f6" },
    });
    expectEffect(side.effects, "direct-apply-blocked", {
      kind: "ui",
      value: { file: "src/servico.ts", blocked: true, overwritten: false },
    });
    expectEffect(side.effects, "both-versions-shown", {
      kind: "ui",
      value: {
        file: "src/servico.ts",
        generatedVersion: "a1b2c3",
        currentVersion: "d4e5f6",
        bothVisible: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["ERR-01"]);
  }
  assertParity(ERR01_SCENARIO);
});

test("ERR-02 caminho fora do workspace aprovado nega a operação e registra 'Caminho fora do escopo.'", () => {
  const run = driveEditorScenario(ERR02_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "out-of-scope-requested", {
      kind: "state",
      value: {
        tool: "write-file",
        target: "../fora-do-workspace/segredos.txt",
      },
    });
    expectEffect(side.effects, "operation-denied", {
      kind: "error",
      value: {
        tool: "write-file",
        code: "OUT_OF_SCOPE",
        executed: false,
      },
    });
    expectEffect(side.effects, "message-recorded", {
      kind: "ui",
      value: {
        message: "Caminho fora do escopo.",
        shown: true,
      },
    });
    requireOrdered(side.effects, EFFECT_NAMES["ERR-02"]);
  }
  assertParity(ERR02_SCENARIO);
});

test("ERR-03 queda no streaming marca a resposta como Incompleta e o retry não repete alteração gravada", () => {
  const run = driveEditorScenario(ERR03_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "stream-partial-received", {
      kind: "state",
      value: { run: "runa-0009", chunks: 3 },
    });
    expectEffect(side.effects, "stream-connection-dropped", {
      kind: "event",
      value: { run: "runa-0009", afterChunks: 3 },
    });
    expectEffect(side.effects, "response-marked-incomplete", {
      kind: "ui",
      value: { run: "runa-0009", status: "Incompleta" },
    });
    expectEffect(side.effects, "partial-record-preserved", {
      kind: "state",
      value: { run: "runa-0009", partialRecorded: true, unchanged: true },
    });
    expectEffect(side.effects, "retry-issued", {
      kind: "state",
      value: { run: "runa-0010", retryOf: "runa-0009", noDuplicateWrite: true },
    });
    requireOrdered(side.effects, EFFECT_NAMES["ERR-03"]);
  }
  assertParity(ERR03_SCENARIO);
});

test("ERR-04 trecho de arquivo recém-excluído sai do índice antes da próxima busca", () => {
  const run = driveEditorScenario(ERR04_SCENARIO);
  assert.ok(run.ok);
  for (const side of [run.cursor, run.openagent]) {
    expectEffect(side.effects, "chunks-indexed", {
      kind: "state",
      value: { chunks: ["src/cliente.ts#L1-40", "src/segredos.ts#L1-25"] },
    });
    expectEffect(side.effects, "path-recently-excluded", {
      kind: "state",
      value: { path: "src/segredos.ts", excluded: true },
    });
    expectEffect(side.effects, "stale-chunk-removed", {
      kind: "state",
      value: {
        path: "src/segredos.ts",
        removed: true,
        beforeNextSearch: true,
      },
    });
    expectEffect(side.effects, "next-search-omits-excluded", {
      kind: "state",
      value: { query: "chave", results: 0, excludedChunks: 0 },
    });
    requireOrdered(side.effects, EFFECT_NAMES["ERR-04"]);
  }
  assertParity(ERR04_SCENARIO);
});

test("os nomes de efeito declarados coincidem com a sequência capturada de cada cenário de provedor e borda", () => {
  for (const scenario of PROVIDER_ERROR_SCENARIOS) {
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

test("cada cenário de provedor e borda usa a versão congelada do Cursor e a versão corrente do OpenAgent", () => {
  for (const scenario of PROVIDER_ERROR_SCENARIOS) {
    assertVersioned(scenario);
  }
});

test("cenários de provedor e borda são determinísticos entre execuções do driver", () => {
  for (const scenario of PROVIDER_ERROR_SCENARIOS) {
    const first = driveEditorScenario(scenario);
    const second = driveEditorScenario(scenario);
    assert.deepEqual(second, first, `cenário não determinístico: ${scenario.scenarioId}`);
  }
});

test("driveEditorScenario não muta as entradas dos cenários de provedor e borda", () => {
  for (const scenario of PROVIDER_ERROR_SCENARIOS) {
    const before = JSON.parse(JSON.stringify(scenario));
    driveEditorScenario(scenario);
    assert.deepEqual(
      scenario as unknown,
      before,
      `entrada mutada: ${scenario.scenarioId}`,
    );
  }
});

test("conjunto completo cobre os 53 requisitos com a única divergência declarada do LOC-01", () => {
  assert.equal(EDITOR_SCENARIOS.length, 53);
  assert.equal(EDITOR_SCENARIOS.length, EDITOR_REQUIREMENT_IDS.length);
  assert.deepEqual(
    EDITOR_SCENARIOS.map((scenario) => scenario.requirementId).join(","),
    EDITOR_REQUIREMENT_IDS.join(","),
  );

  const coverage = editorScenarioCoverage();
  assert.deepEqual(coverage.missing, []);
  assert.equal(coverage.covered.length, 53);

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

test("relatório registra os cenários de provedor e borda por requisito", () => {
  const report = formatEditorScenarioReport();
  const requirementIds = [
    "API-01",
    "API-02",
    "API-03",
    "ERR-01",
    "ERR-02",
    "ERR-03",
    "ERR-04",
  ];
  for (const requirementId of requirementIds) {
    assert.ok(report.includes(`[${requirementId}]`), `requisito ausente do relatório: ${requirementId}`);
    const scenario = scenarioOf(requirementId);
    assert.ok(report.includes(scenario.scenarioId), `cenário ausente do relatório: ${scenario.scenarioId}`);
  }
  assert.ok(report.includes("Cobertura: 53/53"));
});
