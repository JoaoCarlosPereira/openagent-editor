import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário STA-01: execução Concluída ou Cancelada recusa ferramenta nova
// nessa execução; ferramenta só é aceita depois de uma mensagem nova.
// Superfícies são dados puros de dry-drive, sem acoplamento a marca ou
// binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "execucao-terminal": [
    {
      kind: "state",
      name: "run-terminal-state",
      value: { states: ["completed", "cancelled"], terminal: true },
    },
  ],
  "solicitar-ferramenta-na-execucao-terminal": [
    {
      kind: "error",
      name: "new-tool-denied",
      value: { code: "INVALID_STATE", "in-same-run": true },
    },
  ],
  "enviar-mensagem-nova": [
    {
      kind: "event",
      name: "new-message-accepts-tool",
      value: { accepted: true, after: "new-message" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const STA01_SCENARIO: DualScenario = {
  scenarioId: "sta-01-terminal-state",
  requirementId: "STA-01",
  steps: [
    "execucao-terminal",
    "solicitar-ferramenta-na-execucao-terminal",
    "enviar-mensagem-nova",
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
