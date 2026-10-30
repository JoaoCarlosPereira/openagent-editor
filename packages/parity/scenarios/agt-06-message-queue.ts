import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AGT-06: uma mensagem que chega durante uma execução entra na fila,
// e é possível remover um item que ainda não começou; item já iniciado é
// recusado com CONFLICT. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "enviar-mensagem-durante-execucao": [
    { kind: "state", name: "message-queued", value: { queued: true, ordinal: 1 } },
  ],
  "listar-a-fila": [
    { kind: "ui", name: "queue-items", value: { count: 2, ordered: true } },
  ],
  "remover-item-que-nao-comecou": [
    {
      kind: "state",
      name: "queue-item-removed",
      value: { "not-started": true, remaining: 1 },
    },
  ],
  "recusar-remocao-de-item-ja-iniciado": [
    {
      kind: "error",
      name: "queue-item-removal-denied",
      value: { code: "CONFLICT", "not-started-only": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AGT06_SCENARIO: DualScenario = {
  scenarioId: "agt-06-message-queue",
  requirementId: "AGT-06",
  steps: [
    "enviar-mensagem-durante-execucao",
    "listar-a-fila",
    "remover-item-que-nao-comecou",
    "recusar-remocao-de-item-ja-iniciado",
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
