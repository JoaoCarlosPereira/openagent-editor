import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário UI-02: alternar tema claro e escuro e a largura do painel mantendo
// os controles legíveis e preservando as mensagens da conversa. Superfícies
// são dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const effects: Record<string, readonly CaptureEffect[]> = {
  "alternar-tema-claro": [
    { kind: "ui", name: "theme-change", value: { theme: "light", applied: true } },
  ],
  "alternar-tema-escuro": [
    { kind: "ui", name: "theme-change", value: { theme: "dark", applied: true } },
  ],
  "ajustar-largura-do-painel": [
    { kind: "ui", name: "panel-width-change", value: { width: "adjusted", applied: true } },
  ],
  "verificar-controles-legiveis": [
    { kind: "accessibility", name: "controls-readable", value: true },
  ],
  "verificar-mensagens-preservadas": [
    { kind: "state", name: "conversation-preserved", value: { intact: true } },
  ],
};

export const UI02_SCENARIO: DualScenario = {
  scenarioId: "ui-02-theme-panel",
  requirementId: "UI-02",
  steps: [
    "alternar-tema-claro",
    "alternar-tema-escuro",
    "ajustar-largura-do-painel",
    "verificar-controles-legiveis",
    "verificar-mensagens-preservadas",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects,
  },
};
