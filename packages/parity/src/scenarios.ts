import type { Capture, JsonValue } from "./capture.js";
import { driveDualCapture, type DualScenario } from "./dual-driver.js";
import { requirementIds } from "./catalog.js";
import { LOC01_SCENARIO } from "../scenarios/loc-01-open-folder.js";
import { UI01_SCENARIO } from "../scenarios/ui-01-agent-panel.js";
import { UI02_SCENARIO } from "../scenarios/ui-02-theme-panel.js";
import { UI03_SCENARIO } from "../scenarios/ui-03-onboarding.js";
import { UI04_SCENARIO } from "../scenarios/ui-04-agents-window.js";
import { AGT01_SCENARIO } from "../scenarios/agt-01-ask-no-mutation.js";
import { AGT02_SCENARIO } from "../scenarios/agt-02-plan-execution.js";
import { AGT03_SCENARIO } from "../scenarios/agt-03-agent-multi-file-diff.js";
import { AGT04_SCENARIO } from "../scenarios/agt-04-debug-hypothesis-evidence.js";
import { AGT05_SCENARIO } from "../scenarios/agt-05-subagents-named.js";
import { AGT06_SCENARIO } from "../scenarios/agt-06-message-queue.js";
import { AGT07_SCENARIO } from "../scenarios/agt-07-subagent-cancel.js";
import { PRJ01_SCENARIO } from "../scenarios/prj-01-local-coordinator.js";

/** Requisitos cobertos pelo conjunto de cenários diferenciais do editor e agente. */
export const EDITOR_REQUIREMENT_IDS = [
  "LOC-01",
  "UI-01",
  "UI-02",
  "UI-03",
  "UI-04",
  "AGT-01",
  "AGT-02",
  "AGT-03",
  "AGT-04",
  "AGT-05",
  "AGT-06",
  "AGT-07",
  "PRJ-01",
] as const;

/** Cenários diferenciais do editor e do agente local, dirigidos pelo driver dual (task_189). */
export const EDITOR_SCENARIOS: readonly DualScenario[] = [
  LOC01_SCENARIO,
  UI01_SCENARIO,
  UI02_SCENARIO,
  UI03_SCENARIO,
  UI04_SCENARIO,
  AGT01_SCENARIO,
  AGT02_SCENARIO,
  AGT03_SCENARIO,
  AGT04_SCENARIO,
  AGT05_SCENARIO,
  AGT06_SCENARIO,
  AGT07_SCENARIO,
  PRJ01_SCENARIO,
];

export type EditorScenarioRun =
  | {
      ok: true;
      requirementId: string;
      scenarioId: string;
      steps: number;
      cursor: Capture;
      openagent: Capture;
      /** Divergências de efeito entre as superfícies (esperado vazio, exceto LOC-01). */
      divergences: string[];
    }
  | { ok: false; requirementId: string; scenarioId: string; code: "INVALID_STATE" };

const effectKey = (effect: Capture["effects"][number]): string => `${effect.kind}:${effect.name}`;

function valueKey(value: JsonValue): string {
  return JSON.stringify(value);
}

/** Valores dos efeitos agrupados por (kind, name), na ordem de captura. */
function effectValueGroups(capture: Capture): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const effect of capture.effects) {
    const key = effectKey(effect);
    const values = groups.get(key);
    if (values) values.push(valueKey(effect.value));
    else groups.set(key, [valueKey(effect.value)]);
  }
  return groups;
}

/** Compara efeitos observáveis entre as duas superfícies por (kind, name). */
export function compareDualSurfaces(
  cursor: Capture,
  openagent: Capture,
): string[] {
  const divergences: string[] = [];
  const cursorGroups = effectValueGroups(cursor);
  const openagentGroups = effectValueGroups(openagent);
  const seenOnlyOnAgent = new Set(openagentGroups.keys());

  for (const [key, cursorValues] of cursorGroups) {
    seenOnlyOnAgent.delete(key);
    const openagentValues = openagentGroups.get(key);
    if (!openagentValues) {
      divergences.push(`so-no-cursor: ${key}`);
      continue;
    }
    if (cursorValues.join("|") !== openagentValues.join("|")) {
      divergences.push(`valor-divergente: ${key}`);
    }
  }

  for (const key of seenOnlyOnAgent) {
    divergences.push(`so-no-openagent: ${key}`);
  }
  return divergences;
}

/**
 * Dry-drive determinístico de um cenário do editor nas duas superfícies,
 * com comparação de efeitos. Entrada inválida retorna INVALID_STATE sem
 * efeito colateral e sem mutar a entrada.
 */
export function driveEditorScenario(scenario: DualScenario): EditorScenarioRun {
  const result = driveDualCapture(scenario);
  if (!result.ok) {
    return {
      ok: false,
      requirementId: scenario.requirementId,
      scenarioId: scenario.scenarioId,
      code: "INVALID_STATE",
    };
  }
  return {
    ok: true,
    requirementId: result.cursor.requirementId,
    scenarioId: result.cursor.scenarioId,
    steps: scenario.steps.length,
    cursor: result.cursor,
    openagent: result.openagent,
    divergences: compareDualSurfaces(result.cursor, result.openagent),
  };
}

/**
 * Executa todos os cenários do editor e verifica a cobertura de requisitos
 * frente ao catálogo canônico (nenhuma exigência parcial).
 */
export function runAllEditorScenarios(): EditorScenarioRun[] {
  return EDITOR_SCENARIOS.map(driveEditorScenario);
}

export interface EditorScenarioCoverage {
  required: string[];
  covered: string[];
  missing: string[];
}

export function editorScenarioCoverage(
  requirements: readonly string[] = EDITOR_REQUIREMENT_IDS,
): EditorScenarioCoverage {
  const known = new Set(requirementIds);
  const required = [...requirements];
  const covered = new Set(EDITOR_SCENARIOS.map((scenario) => scenario.requirementId));
  return {
    required,
    covered: EDITOR_SCENARIOS.map((scenario) => scenario.requirementId),
    missing: required.filter((id) => known.has(id) && !covered.has(id)),
  };
}

/** Relatório textual reproduzível do conjunto editor, por requisito. */
export function formatEditorScenarioReport(): string {
  const runs = runAllEditorScenarios();
  const coverage = editorScenarioCoverage();
  const lines: string[] = [
    "=== Cenários diferenciais do editor e agente (dual dry-drive) ===",
    `Requisitos obrigatórios: ${coverage.required.join(", ")}`,
    `Cobertura: ${coverage.covered.length}/${coverage.required.length}` +
      (coverage.missing.length === 0
        ? ""
        : `; faltando: ${coverage.missing.join(", ")}`),
  ];

  for (const run of runs) {
    if (!run.ok) {
      lines.push(`[${run.requirementId}] ${run.scenarioId}: FALHA (${run.code})`);
      continue;
    }
    const parity = run.divergences.length === 0
      ? "efeitos identicos"
      : `divergencias: ${run.divergences.join(", ")}`;
    lines.push(
      `[${run.requirementId}] ${run.scenarioId}: passos=${run.steps} ` +
        `efeitos(cursor)=${run.cursor.effects.length} ` +
        `efeitos(openagent)=${run.openagent.effects.length} — ${parity}`,
    );
  }
  lines.push(
    "Nota: evidência de dry-drive bilateral; aceite manual real fica nos cards de UAT (task_198+).",
  );
  return lines.join("\n");
}
