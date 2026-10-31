import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-06: quando a pessoa abre uma conversa lateral, o produto
// conserva as mensagens da conversa principal. Ordem verificada: abertura da
// conversa lateral a partir da principal < preservação das mensagens da
// principal < retorno ao principal com as mesmas mensagens. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-06 (daemon/storage de
// sessões); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "abrir-conversa-lateral": [
    {
      kind: "event",
      name: "side-conversation-opened",
      value: { parent: "sess-alfa-001", side: "sess-alfa-002", from: "msg-006" },
    },
  ],
  "preservar-conversa-principal": [
    {
      kind: "state",
      name: "main-conversation-preserved",
      value: { session: "sess-alfa-001", messages: 6, unchanged: true },
    },
  ],
  "voltar-ao-principal": [
    {
      kind: "ui",
      name: "returned-to-main",
      value: { session: "sess-alfa-001", messages: 6 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES06_SCENARIO: DualScenario = {
  scenarioId: "ses-06-side-conversation-preserves-main",
  requirementId: "SES-06",
  steps: [
    "abrir-conversa-lateral",
    "preservar-conversa-principal",
    "voltar-ao-principal",
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
