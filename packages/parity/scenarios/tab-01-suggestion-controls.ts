import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário TAB-01: ao digitar com Tab ativo, o produto oferece continuação de
// linha ou de bloco com aceitar, recusar e cancelar (inclusive durante a
// geração). Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "digitar-com-tab-ativo": [
    {
      kind: "ui",
      name: "suggestion-offered",
      value: { trigger: "typing", "tab-active": true, location: "src/service.ts:12" },
    },
  ],
  "oferecer-continuacao-de-linha": [
    {
      kind: "ui",
      name: "continuation-suggested",
      value: { scope: "line", location: "src/service.ts:12", "inserted-count": 1 },
    },
  ],
  "oferecer-continuacao-de-bloco": [
    {
      kind: "ui",
      name: "continuation-suggested",
      value: { scope: "block", location: "src/service.ts:18", "inserted-count": 4 },
    },
  ],
  "oferecer-aceitar-recusar-cancelar": [
    {
      kind: "ui",
      name: "suggestion-controls",
      value: { accept: true, reject: true, cancel: true },
    },
  ],
  "cancelar-durante-geracao": [
    {
      kind: "state",
      name: "suggestion-cancelled",
      value: { during: "generation", "partially-applied": false },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const TAB01_SCENARIO: DualScenario = {
  scenarioId: "tab-01-suggestion-controls",
  requirementId: "TAB-01",
  steps: [
    "digitar-com-tab-ativo",
    "oferecer-continuacao-de-linha",
    "oferecer-continuacao-de-bloco",
    "oferecer-aceitar-recusar-cancelar",
    "cancelar-durante-geracao",
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
