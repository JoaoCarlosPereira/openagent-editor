import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-02: quando a pessoa exporta uma sessão, o produto grava um
// arquivo de texto com as mensagens daquela sessão. Ordem verificada:
// pedido de exportação < gravação do arquivo de texto com as mensagens <...
// < confirmação da escrita. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-02 (packages/storage/
// export); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "exportar-sessao": [
    {
      kind: "state",
      name: "session-export-requested",
      value: { session: "sess-alfa-001" },
    },
  ],
  "gravar-arquivo-de-texto": [
    {
      kind: "state",
      name: "export-file-written",
      value: {
        session: "sess-alfa-001",
        file: "sess-alfa-001.txt",
        format: "text",
        messages: 6,
        allMessagesIncluded: true,
      },
    },
  ],
  "confirmar-escrita": [
    {
      kind: "ui",
      name: "export-confirmed",
      value: { session: "sess-alfa-001", file: "sess-alfa-001.txt", shown: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES02_SCENARIO: DualScenario = {
  scenarioId: "ses-02-export-session-text",
  requirementId: "SES-02",
  steps: ["exportar-sessao", "gravar-arquivo-de-texto", "confirmar-escrita"],
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
