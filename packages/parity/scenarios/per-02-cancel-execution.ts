import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PER-02: cancelar uma execução marca o estado Cancelada em até 2
// segundos, não inicia ferramenta nova na mesma execução e conserva a
// alteração já aplicada. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "cancelar-durante-execucao": [
    {
      kind: "event",
      name: "cancel-requested",
      value: { during: "execution" },
    },
    {
      kind: "state",
      name: "cancelled-state",
      value: { state: "cancelled", "within-seconds": 2 },
    },
  ],
  "conservar-alteracao-aplicada": [
    {
      kind: "diff",
      name: "applied-change-preserved",
      value: { preserved: true, files: ["src/service.ts"] },
    },
  ],
  "recusar-ferramenta-nova": [
    {
      kind: "error",
      name: "new-tool-denied",
      value: { code: "CANCELLED", "in-same-run": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PER02_SCENARIO: DualScenario = {
  scenarioId: "per-02-cancel-execution",
  requirementId: "PER-02",
  steps: [
    "cancelar-durante-execucao",
    "conservar-alteracao-aplicada",
    "recusar-ferramenta-nova",
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
