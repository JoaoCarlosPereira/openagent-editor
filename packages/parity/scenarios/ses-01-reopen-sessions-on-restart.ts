import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-01: quando a pessoa reinicia o editor, o produto reabre as
// sessões do workspace com modo, mensagens, invocações de ferramenta e anexos
// que ainda existam. Ordem verificada: reinício do editor < reabertura das
// sessões do workspace < conteúdo por sessão (modo + mensagens + ferramentas +
// anexos). Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende das implementações de SES-01 (storage + daemon);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "reiniciar-editor": [
    {
      kind: "state",
      name: "editor-restarted",
      value: { workspace: "projeto-alfa" },
    },
  ],
  "reabrir-sessoes-do-workspace": [
    {
      kind: "event",
      name: "session-reopened",
      value: { workspace: "projeto-alfa", sessions: 2 },
    },
  ],
  "mostrar-modo-mensagens-ferramentas-anexos": [
    {
      kind: "state",
      name: "session-content-restored",
      value: {
        session: "sess-alfa-001",
        mode: "agent",
        messages: 6,
        toolInvocations: 3,
        attachments: 2,
        allStillExists: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES01_SCENARIO: DualScenario = {
  scenarioId: "ses-01-reopen-sessions-on-restart",
  requirementId: "SES-01",
  steps: [
    "reiniciar-editor",
    "reabrir-sessoes-do-workspace",
    "mostrar-modo-mensagens-ferramentas-anexos",
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
