import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CAN-01: quando o agente abre um canvas, o produto exibe o conteúdo
// no painel e o mantém visível depois do fim da resposta. Ordem verificada:
// abertura < exibição < fim da resposta < persistência. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CAN-01 (task_182); este
// cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "agente-abrir-canvas": [
    {
      kind: "event",
      name: "canvas-opened",
      value: { by: "agent", title: "Comparativo de migração" },
    },
  ],
  "exibir-conteudo-no-painel": [
    {
      kind: "ui",
      name: "canvas-displayed",
      value: { panel: "canvas", visible: true },
    },
  ],
  "finalizar-resposta": [
    {
      kind: "state",
      name: "response-finished",
      value: { state: "completed" },
    },
  ],
  "verificar-canvas-ainda-visivel": [
    {
      kind: "ui",
      name: "canvas-still-visible",
      value: { panel: "canvas", visible: true, "after-response": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CAN01_SCENARIO: DualScenario = {
  scenarioId: "can-01-canvas-persistent-panel",
  requirementId: "CAN-01",
  steps: [
    "agente-abrir-canvas",
    "exibir-conteudo-no-painel",
    "finalizar-resposta",
    "verificar-canvas-ainda-visivel",
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
