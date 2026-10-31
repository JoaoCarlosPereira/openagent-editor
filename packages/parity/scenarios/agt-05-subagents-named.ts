import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-05: ao dividir a tarefa, cada subagente local aparece com nome,
// estado e resultado próprios. Superfícies são dados puros de dry-drive,
// sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "dividir-a-tarefa-em-subagentes": [
    {
      kind: "ui",
      name: "subagent-list",
      value: { count: 2, local: true },
    },
  ],
  "executar-cada-subagente": [
    {
      kind: "ui",
      name: "subagent-entries",
      value: {
        agents: [
          { name: "explorar-workspace", state: "done", result: "found" },
          { name: "atualizar-imports", state: "done", result: "patched" },
        ],
      },
    },
  ],
  "mostrar-resultado-proprio-de-cada-um": [
    {
      kind: "ui",
      name: "subagent-results",
      value: { "per-agent": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT05_SCENARIO: DualScenario = {
  scenarioId: "agt-05-subagents-named",
  requirementId: "AGT-05",
  steps: [
    "dividir-a-tarefa-em-subagentes",
    "executar-cada-subagente",
    "mostrar-resultado-proprio-de-cada-um",
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
