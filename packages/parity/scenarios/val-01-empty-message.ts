import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário VAL-01: enviar mensagem sem texto e sem anexo é recusado com a
// mensagem "Escreva uma mensagem ou anexe um contexto."; um anexo libera o
// envio. Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).

const emptyMessage = "Escreva uma mensagem ou anexe um contexto.";

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "enviar-mensagem-vazia": [
    {
      kind: "error",
      name: "empty-message-refused",
      value: { sent: false, message: emptyMessage },
    },
  ],
  "anexar-contexto-e-enviar": [
    {
      kind: "state",
      name: "message-sent",
      value: { sent: true, attachments: 1 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const VAL01_SCENARIO: DualScenario = {
  scenarioId: "val-01-empty-message",
  requirementId: "VAL-01",
  steps: [
    "enviar-mensagem-vazia",
    "anexar-contexto-e-enviar",
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
