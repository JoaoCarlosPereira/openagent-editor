import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário UI-03: primeira abertura do editor conduz a configuração do
// provedor, executa um teste de conexão e permite abrir um projeto sem conta
// da Anysphere. Superfícies são dados puros de dry-drive, sem acoplamento a
// marca ou binários do Cursor (ADR-002/ADR-007).

const effects: Record<string, readonly CaptureEffect[]> = {
  "abrir-editor-primeira-vez": [
    { kind: "ui", name: "onboarding-screen", value: { visible: true } },
  ],
  "conduzir-configuracao-do-provedor": [
    {
      kind: "state",
      name: "provider-profile-saved",
      value: { endpoint: "local", secretStored: true },
    },
  ],
  "executar-teste-de-conexao": [
    { kind: "event", name: "connection-test", value: { ok: true } },
  ],
  "abrir-projeto-sem-conta": [
    {
      kind: "state",
      name: "project-opened",
      value: { folder: true, "account-required": false },
    },
  ],
};

export const UI03_SCENARIO: DualScenario = {
  scenarioId: "ui-03-onboarding",
  requirementId: "UI-03",
  steps: [
    "abrir-editor-primeira-vez",
    "conduzir-configuracao-do-provedor",
    "executar-teste-de-conexao",
    "abrir-projeto-sem-conta",
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
