import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário API-01: quando a pessoa informa endpoint, modelo e credencial, o
// produto testa a conexão, mostra as capacidades detectadas e guarda a
// credencial no cofre do sistema (sem persistir texto em claro). Ordem
// verificada: credenciais informadas < teste de conexão < capacidades
// detectadas < gravação no cofre. Superfícies são dados puros de dry-drive,
// sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de API-01 (packages/
// model-gateway + packages/storage/src/secrets); este cenário modela o
// contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "informar-credenciais": [
    {
      kind: "state",
      name: "provider-credentials-informed",
      value: {
        endpoint: "http://localhost:8455/v1",
        model: "modelo-local",
        credentialLabel: "chave-do-provedor",
      },
    },
  ],
  "testar-conexao": [
    {
      kind: "ui",
      name: "connection-tested",
      value: {
        endpoint: "http://localhost:8455/v1",
        model: "modelo-local",
        ok: true,
      },
    },
  ],
  "mostrar-capacidades": [
    {
      kind: "ui",
      name: "capabilities-detected",
      value: {
        model: "modelo-local",
        capabilities: ["chat", "edit", "apply"],
        listed: true,
      },
    },
  ],
  "guardar-credencial-cofre": [
    {
      kind: "state",
      name: "credential-stored-system-vault",
      value: {
        vault: "sistema",
        secretRef: "api-01-chave-do-provedor",
        plaintextSaved: false,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const API01_SCENARIO: DualScenario = {
  scenarioId: "api-01-provider-test-vault",
  requirementId: "API-01",
  steps: [
    "informar-credenciais",
    "testar-conexao",
    "mostrar-capacidades",
    "guardar-credencial-cofre",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: "modelo-local",
    provider: "cliproxy-v8.0.45",
    effects: cursorEffects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: "modelo-local",
    provider: "cliproxy-v8.0.45",
    effects: openagentEffects,
  },
};
