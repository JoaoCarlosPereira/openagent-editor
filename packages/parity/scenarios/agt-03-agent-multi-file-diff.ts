import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-03: no modo Agent, a tarefa edita mais de um arquivo, roda um
// teste autorizado e mostra o diff agrupado com o resultado de cada
// ferramenta. Superfícies são dados puros de dry-drive, sem acoplamento a
// marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "executar-tarefa-no-modo-agent": [
    { kind: "ui", name: "agent-run", value: { mode: "agent", started: true } },
  ],
  "editar-multiplos-arquivos": [
    {
      kind: "diff",
      name: "multi-file-edit",
      value: { files: ["model.ts", "service.ts", "model.test.ts"], count: 3 },
    },
  ],
  "rodar-teste-autorizado": [
    {
      kind: "event",
      name: "test-run",
      value: { authorized: true, result: "pass" },
    },
  ],
  "mostrar-diff-agrupado-e-resultados": [
    { kind: "ui", name: "grouped-diff", value: { files: 3, grouped: true } },
    {
      kind: "ui",
      name: "tool-results",
      value: { tools: ["edit", "edit", "edit", "test"], reported: "per-tool" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT03_SCENARIO: DualScenario = {
  scenarioId: "agt-03-agent-multi-file-diff",
  requirementId: "AGT-03",
  steps: [
    "executar-tarefa-no-modo-agent",
    "editar-multiplos-arquivos",
    "rodar-teste-autorizado",
    "mostrar-diff-agrupado-e-resultados",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects: cursorEffects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects: openagentEffects,
  },
};
