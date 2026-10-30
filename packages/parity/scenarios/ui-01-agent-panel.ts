import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário UI-01: janela principal mostra painel do agente, seletor de modo,
// seletor de modelo, contexto, histórico e revisão de alterações, todos
// alcançáveis por teclado. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const effects: Record<string, readonly CaptureEffect[]> = {
  "abrir-painel-do-agente": [
    {
      kind: "ui" as const,
      name: "agent-panel",
      value: { panel: "agent", composer: true, queue: true, attachments: true },
    },
  ],
  "selecionar-modo": [
    { kind: "ui" as const, name: "mode-selector", value: { modes: ["ask", "plan", "agent"] } },
  ],
  "selecionar-modelo": [
    { kind: "ui" as const, name: "model-selector", value: { indicator: true, selector: true } },
  ],
  "anexar-contexto": [
    {
      kind: "ui" as const,
      name: "context-attachment",
      value: { visible: true, "truncation-warning": true },
    },
  ],
  "abrir-historico": [
    { kind: "ui" as const, name: "history", value: { list: true, search: true } },
  ],
  "revisar-alteracoes": [
    { kind: "ui" as const, name: "change-review", value: { "grouped-diff": true } },
  ],
  "navegar-por-teclado": [
    { kind: "accessibility" as const, name: "keyboard-accessible", value: true },
  ],
};

export const UI01_SCENARIO: DualScenario = {
  scenarioId: "ui-01-agent-panel",
  requirementId: "UI-01",
  steps: [
    "abrir-painel-do-agente",
    "selecionar-modo",
    "selecionar-modelo",
    "anexar-contexto",
    "abrir-historico",
    "revisar-alteracoes",
    "navegar-por-teclado",
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
