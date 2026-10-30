import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CTX-03: enquanto um caminho estiver em regra de exclusão, ele fica
// omitido da indexação, do contexto automático e da busca do agente.
// Superfícies são dados puros de dry-drive, sem acoplamento a marca ou
// binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "aplicar-regra-de-exclusão": [
    {
      kind: "state",
      name: "exclusion-rule-active",
      value: { pattern: "secrets/**" },
    },
  ],
  "omitir-da-indexação": [
    {
      kind: "state",
      name: "path-omitted-from-index",
      value: { path: "secrets/env.ts", indexed: false },
    },
  ],
  "omitir-do-contexto-automático": [
    {
      kind: "ui",
      name: "path-omitted-from-auto-context",
      value: { path: "secrets/env.ts", included: false },
    },
  ],
  "omitir-da-busca-do-agente": [
    {
      kind: "ui",
      name: "path-omitted-from-agent-search",
      value: { query: "chaveApi", matches: 0 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CTX03_SCENARIO: DualScenario = {
  scenarioId: "ctx-03-excluded-path-omitted",
  requirementId: "CTX-03",
  steps: [
    "aplicar-regra-de-exclusão",
    "omitir-da-indexação",
    "omitir-do-contexto-automático",
    "omitir-da-busca-do-agente",
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
