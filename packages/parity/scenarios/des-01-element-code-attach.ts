import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário DES-01: ao selecionar um elemento no navegador em modo de desenho,
// o produto anexa a identificação do elemento e o trecho de código associado
// à mensagem seguinte do agente. Ordem verificada: modo ativo < seleção <
// anexo antes do envio. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de DES-01 (task_181); este
// cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "ativar-modo-de-desenho-no-navegador": [
    {
      kind: "ui",
      name: "drawing-mode-active",
      value: { mode: "drawing", surface: "browser" },
    },
  ],
  "selecionar-elemento-no-navegador": [
    {
      kind: "event",
      name: "element-selected",
      value: { selector: "button#submit", tag: "button" },
    },
  ],
  "anexar-identificacao-e-trecho-a-proxima-mensagem": [
    {
      kind: "ui",
      name: "element-context-attached",
      value: {
        selector: "button#submit",
        snippet: "web/app.tsx#L40-L46",
        "attach-to": "next-message",
        "before-send": true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const DES01_SCENARIO: DualScenario = {
  scenarioId: "des-01-element-code-attach",
  requirementId: "DES-01",
  steps: [
    "ativar-modo-de-desenho-no-navegador",
    "selecionar-elemento-no-navegador",
    "anexar-identificacao-e-trecho-a-proxima-mensagem",
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
