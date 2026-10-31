import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-04: no modo Debug, o produto registra a hipótese, a evidência
// de execução e o resultado da verificação antes de marcar a tarefa como
// concluída. Superfícies são dados puros de dry-drive, sem acoplamento a
// marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "registrar-hipotese": [
    {
      kind: "state",
      name: "debug-hypothesis",
      value: { recorded: true, conclusion: "pending" },
    },
  ],
  "executar-e-coletar-evidencia": [
    {
      kind: "event",
      name: "execution-evidence",
      value: { collected: true, source: "test-run" },
    },
  ],
  "verificar-a-hipotese": [
    {
      kind: "event",
      name: "verification-result",
      value: { confirmed: true },
    },
  ],
  "marcar-tarefa-como-concluida": [
    { kind: "state", name: "task-completion", value: { allowed: true } },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT04_SCENARIO: DualScenario = {
  scenarioId: "agt-04-debug-hypothesis-evidence",
  requirementId: "AGT-04",
  steps: [
    "registrar-hipotese",
    "executar-e-coletar-evidencia",
    "verificar-a-hipotese",
    "marcar-tarefa-como-concluida",
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
