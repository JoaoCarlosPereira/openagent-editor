import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CTX-01: anexar seleção, arquivo, pasta ou símbolo lista cada fonte
// e mostra a contagem de tokens e o teto antes do envio. Superfícies são dados
// puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "anexar-seleção": [
    {
      kind: "ui",
      name: "selection-attached",
      value: { source: "selection", target: "src/index.ts#L12-L18" },
    },
  ],
  "anexar-arquivo": [
    {
      kind: "ui",
      name: "file-attached",
      value: { source: "file", target: "src/service.ts" },
    },
  ],
  "anexar-pasta": [
    {
      kind: "ui",
      name: "folder-attached",
      value: { source: "folder", target: "src/lib" },
    },
  ],
  "anexar-símbolo": [
    {
      kind: "ui",
      name: "symbol-attached",
      value: { source: "symbol", target: "function: authorize" },
    },
  ],
  "mostrar-resumo-antes-do-envio": [
    {
      kind: "ui",
      name: "context-summary-before-send",
      value: { sources: 4, tokens: 1855, ceiling: 200000, "visible-before-send": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CTX01_SCENARIO: DualScenario = {
  scenarioId: "ctx-01-attach-context-summary",
  requirementId: "CTX-01",
  steps: [
    "anexar-seleção",
    "anexar-arquivo",
    "anexar-pasta",
    "anexar-símbolo",
    "mostrar-resumo-antes-do-envio",
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
