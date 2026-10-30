import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-02: ao aceitar um plano no modo Plan, o produto inicia a
// execução com o plano e o progresso visíveis. Superfícies são dados puros
// de dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "propor-plano-no-modo-plan": [
    { kind: "ui", name: "plan-proposal", value: { steps: 3, visible: true } },
  ],
  "aceitar-o-plano": [
    { kind: "state", name: "plan-accepted", value: { accepted: true } },
  ],
  "iniciar-execucao-com-o-plano": [
    {
      kind: "event",
      name: "execution-started",
      value: { "plan-visible": true },
    },
  ],
  "mostrar-progresso-das-etapas": [
    {
      kind: "ui",
      name: "execution-progress",
      value: { steps: { done: 1, total: 3 }, visible: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT02_SCENARIO: DualScenario = {
  scenarioId: "agt-02-plan-execution",
  requirementId: "AGT-02",
  steps: [
    "propor-plano-no-modo-plan",
    "aceitar-o-plano",
    "iniciar-execucao-com-o-plano",
    "mostrar-progresso-das-etapas",
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
