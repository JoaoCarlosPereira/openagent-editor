import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário API-03: ao enviar uma mensagem, o produto exibe o teto de contexto
// em tokens; quando a pessoa não gravou outro valor, o teto padrão é
// 200000. Ordem verificada: envio sem teto gravado < teto padrão exibido <
// envio com teto gravado < teto gravado exibido. Superfícies são dados puros
// de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de API-03 (packages/context +
// apps/editor/src/context); este cenário modela o contrato pelas tabelas de
// efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "enviar-sem-teto-gravado": [
    {
      kind: "state",
      name: "message-submitted-without-ceiling",
      value: { session: "sess-alfa-001", ceilingSaved: null },
    },
  ],
  "exibir-teto-padrao": [
    {
      kind: "ui",
      name: "context-ceiling-displayed",
      value: { tokens: 200000, source: "padrao" },
    },
  ],
  "enviar-com-teto-gravado": [
    {
      kind: "state",
      name: "message-submitted-with-saved-ceiling",
      value: { session: "sess-alfa-001", ceilingSaved: 100000 },
    },
  ],
  "exibir-teto-gravado": [
    {
      kind: "ui",
      name: "saved-context-ceiling-displayed",
      value: { tokens: 100000, source: "gravado" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const API03_SCENARIO: DualScenario = {
  scenarioId: "api-03-context-ceiling-default",
  requirementId: "API-03",
  steps: [
    "enviar-sem-teto-gravado",
    "exibir-teto-padrao",
    "enviar-com-teto-gravado",
    "exibir-teto-gravado",
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
