import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário INL-01: ao pedir Inline Edit na seleção, o produto mostra o diff no
// editor com aceitar, rejeitar e refinar. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "pedir-inline-edit-na-selecao": [
    {
      kind: "event",
      name: "inline-edit-requested",
      value: { target: "selection", range: "src/index.ts#L12-L18" },
    },
  ],
  "mostrar-diff-no-editor": [
    {
      kind: "diff",
      name: "diff-shown-in-editor",
      value: { file: "src/index.ts", "in-editor": true, added: 5, removed: 3 },
    },
  ],
  "oferecer-aceitar-rejeitar-refinar": [
    {
      kind: "ui",
      name: "inline-edit-controls",
      value: { accept: true, reject: true, refine: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const INL01_SCENARIO: DualScenario = {
  scenarioId: "inl-01-inline-edit-diff",
  requirementId: "INL-01",
  steps: [
    "pedir-inline-edit-na-selecao",
    "mostrar-diff-no-editor",
    "oferecer-aceitar-rejeitar-refinar",
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
