import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário AUT-02: ao autorizar o uso do computador, o produto executa uma
// ação por vez, nomeada na permissão, mostra o resultado e recusa ação não
// autorizada. Ordem verificada: autorização < ação nomeada < resultado <
// recusa da ação fora do escopo. Superfícies são dados puros de dry-drive,
// sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "autorizar-uso-do-computador": [
    {
      kind: "state",
      name: "computer-permission-granted",
      value: { tool: "computer-use", authorized: true, "named-action": "screenshot" },
    },
  ],
  "executar-uma-acao-por-vez": [
    {
      kind: "event",
      name: "single-action-executed",
      value: { action: "screenshot", "one-at-a-time": true },
    },
  ],
  "mostrar-resultado-da-acao": [
    {
      kind: "ui",
      name: "action-result-shown",
      value: { action: "screenshot", result: "captured", visible: true },
    },
  ],
  "negar-acao-nomeada-fora-da-permissao": [
    {
      kind: "error",
      name: "unauthorized-action-denied",
      value: { action: "run-shell", code: "PERMISSION_DENIED", granted: "screenshot" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const AUT02_SCENARIO: DualScenario = {
  scenarioId: "aut-02-computer-action-at-a-time",
  requirementId: "AUT-02",
  steps: [
    "autorizar-uso-do-computador",
    "executar-uma-acao-por-vez",
    "mostrar-resultado-da-acao",
    "negar-acao-nomeada-fora-da-permissao",
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
