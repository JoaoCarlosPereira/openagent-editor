import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-05: quando a pessoa busca um texto na conversa, o produto
// lista as mensagens da sessão local que contêm esse texto. Ordem verificada:
// busca na conversa < listagem das mensagens da sessão local que contêm o
// texto. Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-05 (packages/storage/
// search); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "buscar-texto-na-conversa": [
    {
      kind: "state",
      name: "conversation-search-performed",
      value: { session: "sess-alfa-001", query: "anexo" },
    },
  ],
  "listar-mensagens-encontradas": [
    {
      kind: "ui",
      name: "conversation-matches-listed",
      value: {
        session: "sess-alfa-001",
        query: "anexo",
        matches: ["msg-001", "msg-004", "msg-010"],
        count: 3,
        source: "sessao-local",
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES05_SCENARIO: DualScenario = {
  scenarioId: "ses-05-conversation-search",
  requirementId: "SES-05",
  steps: ["buscar-texto-na-conversa", "listar-mensagens-encontradas"],
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
