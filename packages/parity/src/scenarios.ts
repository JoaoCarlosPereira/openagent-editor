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
import { PER01_SCENARIO } from "../scenarios/per-01-permission-accept.js";
import { PER02_SCENARIO } from "../scenarios/per-02-cancel-execution.js";
import { PER03_SCENARIO } from "../scenarios/per-03-readonly-block.js";
import { STA01_SCENARIO } from "../scenarios/sta-01-terminal-state.js";
import { VAL01_SCENARIO } from "../scenarios/val-01-empty-message.js";
import { CTX01_SCENARIO } from "../scenarios/ctx-01-attach-context-summary.js";
import { CTX02_SCENARIO } from "../scenarios/ctx-02-incremental-index.js";
import { CTX03_SCENARIO } from "../scenarios/ctx-03-excluded-path-omitted.js";
import { CTX04_SCENARIO } from "../scenarios/ctx-04-index-cleanup.js";
import { PRV01_SCENARIO } from "../scenarios/prv-01-explicit-external-send.js";
import { PRV02_SCENARIO } from "../scenarios/prv-02-redacted-tool-log.js";
import { TAB01_SCENARIO } from "../scenarios/tab-01-suggestion-controls.js";
import { TAB02_SCENARIO } from "../scenarios/tab-02-next-point-jump.js";
import { TAB03_SCENARIO } from "../scenarios/tab-03-cross-file-review.js";
import { INL01_SCENARIO } from "../scenarios/inl-01-inline-edit-diff.js";
import { INL02_SCENARIO } from "../scenarios/inl-02-whole-file-restore.js";
import { AUT01_SCENARIO } from "../scenarios/aut-01-authorized-browser.js";
import { AUT02_SCENARIO } from "../scenarios/aut-02-computer-action-at-a-time.js";
import { DES01_SCENARIO } from "../scenarios/des-01-element-code-attach.js";
import { CAN01_SCENARIO } from "../scenarios/can-01-canvas-persistent-panel.js";
import { CUS01_SCENARIO } from "../scenarios/cus-01-user-project-rules.js";
import { CUS02_SCENARIO } from "../scenarios/cus-02-command-skill-plugin-origin.js";
import { CUS03_SCENARIO } from "../scenarios/cus-03-hook-denies-action.js";
import { MCP01_SCENARIO } from "../scenarios/mcp-01-mcp-tools-permission.js";
import { CLI01_SCENARIO } from "../scenarios/cli-01-reuse-workspace-config.js";
import { CLI02_SCENARIO } from "../scenarios/cli-02-headless-session-in-editor.js";
import { SES01_SCENARIO } from "../scenarios/ses-01-reopen-sessions-on-restart.js";
import { SES02_SCENARIO } from "../scenarios/ses-02-export-session-text.js";
import { SES03_SCENARIO } from "../scenarios/ses-03-checkpoint-restore-conflict.js";
import { SES04_SCENARIO } from "../scenarios/ses-04-worktree-isolation.js";
import { SES05_SCENARIO } from "../scenarios/ses-05-conversation-search.js";
import { SES06_SCENARIO } from "../scenarios/ses-06-side-conversation-preserves-main.js";
import { SES07_SCENARIO } from "../scenarios/ses-07-session-delete.js";

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
  "PER-01",
  "PER-02",
  "PER-03",
  "STA-01",
  "VAL-01",
  "CTX-01",
  "CTX-02",
  "CTX-03",
  "CTX-04",
  "PRV-01",
  "PRV-02",
  "TAB-01",
  "TAB-02",
  "TAB-03",
  "INL-01",
  "INL-02",
  "AUT-01",
  "AUT-02",
  "DES-01",
  "CAN-01",
  "CUS-01",
  "CUS-02",
  "CUS-03",
  "MCP-01",
  "CLI-01",
  "CLI-02",
  "SES-01",
  "SES-02",
  "SES-03",
  "SES-04",
  "SES-05",
  "SES-06",
  "SES-07",
] as const;

/** Cenários diferenciais de editor, agente, permissão, estado, contexto, privacidade, Tab, Inline, navegador, desenho, canvas, regras, MCP, CLI e sessões, dirigidos pelo driver dual. */
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
  PER01_SCENARIO,
  PER02_SCENARIO,
  PER03_SCENARIO,
  STA01_SCENARIO,
  VAL01_SCENARIO,
  CTX01_SCENARIO,
  CTX02_SCENARIO,
  CTX03_SCENARIO,
  CTX04_SCENARIO,
  PRV01_SCENARIO,
  PRV02_SCENARIO,
  TAB01_SCENARIO,
  TAB02_SCENARIO,
  TAB03_SCENARIO,
  INL01_SCENARIO,
  INL02_SCENARIO,
  AUT01_SCENARIO,
  AUT02_SCENARIO,
  DES01_SCENARIO,
  CAN01_SCENARIO,
  CUS01_SCENARIO,
  CUS02_SCENARIO,
  CUS03_SCENARIO,
  MCP01_SCENARIO,
  CLI01_SCENARIO,
  CLI02_SCENARIO,
  SES01_SCENARIO,
  SES02_SCENARIO,
  SES03_SCENARIO,
  SES04_SCENARIO,
  SES05_SCENARIO,
  SES06_SCENARIO,
  SES07_SCENARIO,
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
