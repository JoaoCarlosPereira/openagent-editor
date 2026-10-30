import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CTX-04: pedir a limpeza do índice mostra escopo e tamanho e apaga
// os dados locais daquele workspace. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "pedir-limpeza-do-índice": [
    {
      kind: "event",
      name: "cleanup-requested",
      value: { action: "clear-index" },
    },
  ],
  "mostrar-escopo-e-tamanho": [
    {
      kind: "ui",
      name: "cleanup-scope-and-size-shown",
      value: { scope: "workspace", workspace: "projeto-alfa", "size-bytes": 4718592 },
    },
  ],
  "apagar-dados-do-workspace": [
    {
      kind: "state",
      name: "workspace-local-data-cleared",
      value: { scope: "workspace", cleared: true, "remaining-bytes": 0 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CTX04_SCENARIO: DualScenario = {
  scenarioId: "ctx-04-index-cleanup",
  requirementId: "CTX-04",
  steps: [
    "pedir-limpeza-do-índice",
    "mostrar-escopo-e-tamanho",
    "apagar-dados-do-workspace",
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
