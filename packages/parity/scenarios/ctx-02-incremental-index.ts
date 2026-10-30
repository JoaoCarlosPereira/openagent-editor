import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CTX-02: salvar arquivo indexado passa a ser encontrado pela busca
// local com atualização incremental, sem reconstruir o índice inteiro.
// Superfícies são dados puros de dry-drive, sem acoplamento a marca ou
// binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "salvar-arquivo-indexado": [
    {
      kind: "event",
      name: "file-saved",
      value: { file: "src/service.ts", indexed: true },
    },
  ],
  "atualizar-indice-incremental": [
    {
      kind: "state",
      name: "index-updated-incrementally",
      value: { mode: "incremental", files: ["src/service.ts"], "full-rebuild": false },
    },
  ],
  "buscar-texto-novo": [
    {
      kind: "ui",
      name: "search-finds-new-text",
      value: { query: "autorizacaoRenovada", matches: 1, "without-full-rebuild": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CTX02_SCENARIO: DualScenario = {
  scenarioId: "ctx-02-incremental-index",
  requirementId: "CTX-02",
  steps: [
    "salvar-arquivo-indexado",
    "atualizar-indice-incremental",
    "buscar-texto-novo",
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
