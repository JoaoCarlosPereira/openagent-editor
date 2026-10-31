import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CUS-03: quando um hook local nega uma ação, o produto impede a ação
// e mostra a justificativa do hook. Ordem verificada: negação do hook <
// ação impedida < justificativa mostrada. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CUS-03 (hooks na policy);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "hook-negar-acao": [
    {
      kind: "event",
      name: "hook-denied",
      value: { hook: "pre-tool-use", tool: "run-command" },
    },
  ],
  "impedir-acao": [
    {
      kind: "state",
      name: "action-blocked",
      value: { executed: false, code: "HOOK_DENIED" },
    },
  ],
  "mostrar-justificativa": [
    {
      kind: "ui",
      name: "hook-justification-shown",
      value: {
        message: "Hook local negou: comandos de rede desativados neste repositório.",
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CUS03_SCENARIO: DualScenario = {
  scenarioId: "cus-03-hook-denies-action",
  requirementId: "CUS-03",
  steps: [
    "hook-negar-acao",
    "impedir-acao",
    "mostrar-justificativa",
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
