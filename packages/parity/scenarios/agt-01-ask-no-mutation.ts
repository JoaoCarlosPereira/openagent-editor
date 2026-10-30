import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-01: no modo Ask, o produto responde com leitura e busca,
// sem gravar arquivo e sem executar comando no workspace. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "escolher-modo-ask": [
    { kind: "ui", name: "mode-selected", value: { mode: "ask" } },
  ],
  "perguntar-sobre-a-funcao": [
    { kind: "event", name: "question-sent", value: { context: "selected-function", answer: "drafted" } },
  ],
  "responder-usando-leitura-e-busca": [
    {
      kind: "event",
      name: "tool-usage",
      value: { tools: ["read", "search"], mutating: false },
    },
  ],
  "verificar-workspace-sem-mutacao": [
    {
      kind: "state",
      name: "workspace-mutation",
      value: { "files-written": 0, "commands-executed": 0 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT01_SCENARIO: DualScenario = {
  scenarioId: "agt-01-ask-no-mutation",
  requirementId: "AGT-01",
  steps: [
    "escolher-modo-ask",
    "perguntar-sobre-a-funcao",
    "responder-usando-leitura-e-busca",
    "verificar-workspace-sem-mutacao",
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
