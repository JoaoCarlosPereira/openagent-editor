import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PRV-01: contexto só vai a uma API externa depois de uma ação
// explícita de envio, e caminho em exclusão nunca é enviado. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "montar-contexto-local": [
    {
      kind: "state",
      name: "context-assembled-locally",
      value: { destination: "local", sent: false },
    },
  ],
  "registrar-ação-explícita-de-envio": [
    {
      kind: "event",
      name: "explicit-send-action",
      value: { action: "enviar", explicit: true },
    },
  ],
  "enviar-a-api-externa": [
    {
      kind: "event",
      name: "context-sent-to-external-api",
      value: { destination: "external-api", "after-explicit-action": true },
    },
  ],
  "verificar-caminho-excluído-não-enviado": [
    {
      kind: "state",
      name: "excluded-path-never-sent",
      value: { path: "secrets/env.ts", sent: false },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PRV01_SCENARIO: DualScenario = {
  scenarioId: "prv-01-explicit-external-send",
  requirementId: "PRV-01",
  steps: [
    "montar-contexto-local",
    "registrar-ação-explícita-de-envio",
    "enviar-a-api-externa",
    "verificar-caminho-excluído-não-enviado",
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
