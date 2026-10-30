import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AUT-01: ao autorizar o navegador, o produto abre a URL indicada,
// executa a interação autorizada e mostra a captura e o texto de console.
// Ordem verificada: autorização < abertura da URL < interação < captura /
// console. Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "autorizar-navegador": [
    {
      kind: "state",
      name: "browser-permission-granted",
      value: { tool: "browser", authorized: true, scope: "session" },
    },
  ],
  "abrir-url-indicada": [
    {
      kind: "ui",
      name: "url-opened",
      value: { url: "http://localhost:3000", visible: true },
    },
  ],
  "executar-interacao-autorizada": [
    {
      kind: "event",
      name: "authorized-interaction-executed",
      value: { actions: ["click", "type"], within: "authorized-scope" },
    },
  ],
  "mostrar-captura": [
    {
      kind: "ui",
      name: "screenshot-shown",
      value: { capture: true, format: "png", visible: true },
    },
  ],
  "mostrar-texto-de-console": [
    {
      kind: "ui",
      name: "console-shown",
      value: { messages: 3, visible: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AUT01_SCENARIO: DualScenario = {
  scenarioId: "aut-01-authorized-browser",
  requirementId: "AUT-01",
  steps: [
    "autorizar-navegador",
    "abrir-url-indicada",
    "executar-interacao-autorizada",
    "mostrar-captura",
    "mostrar-texto-de-console",
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
