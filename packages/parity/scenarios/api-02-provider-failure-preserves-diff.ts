import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário API-02: quando a falha do provedor (expiração, recusa por taxa ou
// ausência da capacidade pedida) derruba a execução, o produto exibe a causa
// retornada, conserva o texto digitado e não apaga o diff já produzido. Ordem
// verificada: diff prévio gravado < falha do provedor < causa exibida <
// conservação do prompt e do diff. Superfícies são dados puros de dry-drive,
// sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de API-02 (packages/
// model-gateway + services/harness-daemon); este cenário modela o contrato
// pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "gerar-diff-previo": [
    {
      kind: "diff",
      name: "previous-diff-produced",
      value: { file: "src/servico.ts", additions: 12, deletions: 4 },
    },
  ],
  "enviar-com-falha": [
    {
      kind: "error",
      name: "provider-failure-received",
      value: { provider: "cliproxy-v8.0.45", cause: "quota_exceeded" },
    },
  ],
  "exibir-causa": [
    {
      kind: "ui",
      name: "failure-cause-displayed",
      value: {
        cause: "quota_exceeded",
        text: "Recusa do provedor por taxa excedida.",
      },
    },
  ],
  "conservar-prompt-e-diff": [
    {
      kind: "state",
      name: "typed-text-preserved",
      value: {
        message: "Refatorar o serviço de clientes",
        preserved: true,
      },
    },
    {
      kind: "state",
      name: "previous-diff-preserved",
      value: {
        file: "src/servico.ts",
        additions: 12,
        deletions: 4,
        unchanged: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const API02_SCENARIO: DualScenario = {
  scenarioId: "api-02-provider-failure-preserves-diff",
  requirementId: "API-02",
  steps: [
    "gerar-diff-previo",
    "enviar-com-falha",
    "exibir-causa",
    "conservar-prompt-e-diff",
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
