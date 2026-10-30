import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CLI-02: quando uma execução headless da CLI termina, o produto
// mostra essa sessão ao abrir o mesmo workspace no editor. Ordem verificada:
// fim da execução headless < editor aberto no mesmo workspace < sessão
// visível. Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CLI-02 (apps/cli + storage);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "concluir-execucao-headless": [
    {
      kind: "state",
      name: "headless-run-finished",
      value: { exit: 0, session: "sess-headless-001" },
    },
  ],
  "abrir-editor-no-mesmo-workspace": [
    {
      kind: "event",
      name: "editor-opened",
      value: { workspace: "projeto-alfa", same: true },
    },
  ],
  "mostrar-sessao-no-editor": [
    {
      kind: "ui",
      name: "session-visible-in-editor",
      value: { session: "sess-headless-001", visible: true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CLI02_SCENARIO: DualScenario = {
  scenarioId: "cli-02-headless-session-in-editor",
  requirementId: "CLI-02",
  steps: [
    "concluir-execucao-headless",
    "abrir-editor-no-mesmo-workspace",
    "mostrar-sessao-no-editor",
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
