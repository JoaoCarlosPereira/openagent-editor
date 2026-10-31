import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário TAB-02: ao aceitar uma sugestão que tenha continuação, o produto
// indica o próximo ponto de edição e permite o salto por teclado. Superfícies
// são dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "aceitar-sugestao-com-continuacao": [
    {
      kind: "event",
      name: "suggestion-accepted",
      value: { "has-continuation": true, "instances-remaining": 2 },
    },
  ],
  "indicar-proximo-ponto": [
    {
      kind: "ui",
      name: "next-point-indicated",
      value: { count: 2, location: "src/service.ts:18", "awaiting-jump": true },
    },
  ],
  "saltar-por-teclado": [
    {
      kind: "state",
      name: "keyboard-jump",
      value: { key: "Tab", location: "src/service.ts:18", "cursor-moved": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const TAB02_SCENARIO: DualScenario = {
  scenarioId: "tab-02-next-point-jump",
  requirementId: "TAB-02",
  steps: [
    "aceitar-sugestao-com-continuacao",
    "indicar-proximo-ponto",
    "saltar-por-teclado",
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
