import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário ERR-02: quando uma ferramenta pede um caminho fora do workspace
// aprovado, o produto nega a operação e registra "Caminho fora do escopo.".
// Ordem verificada: pedido fora do escopo < negação da operação < registro
// da mensagem. Superfícies são dados puros de dry-drive, sem acoplamento a
// marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de ERR-02 (packages/policy/
// src/paths); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "solicitar-operacao-fora": [
    {
      kind: "state",
      name: "out-of-scope-requested",
      value: {
        tool: "write-file",
        target: "../fora-do-workspace/segredos.txt",
      },
    },
  ],
  "negar-operacao": [
    {
      kind: "error",
      name: "operation-denied",
      value: {
        tool: "write-file",
        code: "OUT_OF_SCOPE",
        executed: false,
      },
    },
  ],
  "registrar-mensagem": [
    {
      kind: "ui",
      name: "message-recorded",
      value: {
        message: "Caminho fora do escopo.",
        shown: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const ERR02_SCENARIO: DualScenario = {
  scenarioId: "err-02-path-out-of-scope",
  requirementId: "ERR-02",
  steps: [
    "solicitar-operacao-fora",
    "negar-operacao",
    "registrar-mensagem",
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
