import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-07: quando a pessoa apaga uma sessão, o produto remove as
// mensagens locais dessa sessão (sem afetar as demais sessões do workspace).
// Ordem verificada: confirmação do apagamento < remoção das mensagens locais
// daquela sessão < integridade das outras sessões. Superfícies são dados
// puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-07 (packages/storage/
// delete); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "apagar-sessao": [
    {
      kind: "state",
      name: "session-delete-confirmed",
      value: { session: "sess-alfa-002", workspace: "projeto-alfa" },
    },
  ],
  "remover-mensagens-locais": [
    {
      kind: "state",
      name: "local-messages-removed",
      value: { session: "sess-alfa-002", removed: 4, remaining: 0 },
    },
  ],
  "conservar-outras-sessoes": [
    {
      kind: "state",
      name: "other-sessions-unaffected",
      value: { session: "sess-alfa-001", messages: 6 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES07_SCENARIO: DualScenario = {
  scenarioId: "ses-07-session-delete",
  requirementId: "SES-07",
  steps: ["apagar-sessao", "remover-mensagens-locais", "conservar-outras-sessoes"],
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
