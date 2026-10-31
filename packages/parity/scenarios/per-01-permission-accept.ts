import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PER-01: ferramenta que precisa de permissão mostra ação, alvo e
// escopo, e executa somente depois de um aceite explícito. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "mostrar-acao-alvo-e-escopo": [
    {
      kind: "ui",
      name: "permission-request",
      value: { action: "edit", target: "src/service.ts", scope: "workspace", visible: true },
    },
  ],
  "aceitar-explicitamente": [
    {
      kind: "state",
      name: "explicit-accept",
      value: { accepted: true, "granted-before-execution": true },
    },
  ],
  "executar-ferramenta": [
    {
      kind: "event",
      name: "tool-executed",
      value: { action: "edit", target: "src/service.ts", order: "after-accept" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PER01_SCENARIO: DualScenario = {
  scenarioId: "per-01-permission-accept",
  requirementId: "PER-01",
  steps: [
    "mostrar-acao-alvo-e-escopo",
    "aceitar-explicitamente",
    "executar-ferramenta",
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
