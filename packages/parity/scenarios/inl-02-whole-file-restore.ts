import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário INL-02: ao pedir edição do arquivo inteiro, o produto mostra a
// prévia, permite rejeitar e restaura o conteúdo anterior ao pedido. Ordem
// verificada: rejeição < restauração. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "pedir-edicao-do-arquivo-inteiro": [
    {
      kind: "event",
      name: "whole-file-edit-requested",
      value: { target: "src/service.ts", scope: "whole-file" },
    },
  ],
  "mostrar-previa-do-arquivo-inteiro": [
    {
      kind: "diff",
      name: "whole-file-preview-shown",
      value: { file: "src/service.ts", preview: true, added: 42, removed: 18 },
    },
  ],
  "rejeitar-edicao": [
    {
      kind: "state",
      name: "edit-rejected",
      value: { file: "src/service.ts", rejected: true },
    },
  ],
  "restaurar-conteudo-anterior": [
    {
      kind: "diff",
      name: "previous-content-restored",
      value: { file: "src/service.ts", restored: true, "before-request": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const INL02_SCENARIO: DualScenario = {
  scenarioId: "inl-02-whole-file-restore",
  requirementId: "INL-02",
  steps: [
    "pedir-edicao-do-arquivo-inteiro",
    "mostrar-previa-do-arquivo-inteiro",
    "rejeitar-edicao",
    "restaurar-conteudo-anterior",
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
