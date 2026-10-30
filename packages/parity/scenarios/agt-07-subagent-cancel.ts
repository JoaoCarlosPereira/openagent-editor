import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-07: cancelar um subagente interrompe somente esse subagente e
// conserva o estado dos demais. Superfícies são dados puros de dry-drive,
// sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "cancelar-um-subagente": [
    {
      kind: "event",
      name: "subagent-cancelled",
      value: { agent: "atualizar-imports", "parent-run": "kept" },
    },
  ],
  "conservar-o-estado-dos-demais": [
    {
      kind: "state",
      name: "remaining-subagents-intact",
      value: { affected: 0, preserved: ["explorar-workspace"] },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT07_SCENARIO: DualScenario = {
  scenarioId: "agt-07-subagent-cancel",
  requirementId: "AGT-07",
  steps: [
    "cancelar-um-subagente",
    "conservar-o-estado-dos-demais",
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
