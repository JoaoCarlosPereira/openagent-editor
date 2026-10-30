import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário ERR-04: quando o índice ainda tem trecho de arquivo que passou a
// estar excluído, o produto remove esse trecho antes da próxima busca. Ordem
// verificada: trechos indexados < caminho recém-excluído < remoção do trecho
// ultrapassado < busca seguinte sem o trecho excluído. Superfícies são dados
// puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de ERR-04 (packages/context/
// src/indexer); este cenário modela o contrato pelas tabelas de efeitos
// puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "indexar-trechos": [
    {
      kind: "state",
      name: "chunks-indexed",
      value: {
        chunks: ["src/cliente.ts#L1-40", "src/segredos.ts#L1-25"],
      },
    },
  ],
  "marcar-caminho-excluido": [
    {
      kind: "state",
      name: "path-recently-excluded",
      value: { path: "src/segredos.ts", excluded: true },
    },
  ],
  "remover-trecho-antes-da-busca": [
    {
      kind: "state",
      name: "stale-chunk-removed",
      value: {
        path: "src/segredos.ts",
        removed: true,
        beforeNextSearch: true,
      },
    },
  ],
  "confirmar-busca-limpa": [
    {
      kind: "state",
      name: "next-search-omits-excluded",
      value: { query: "chave", results: 0, excludedChunks: 0 },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const ERR04_SCENARIO: DualScenario = {
  scenarioId: "err-04-index-removes-recently-excluded",
  requirementId: "ERR-04",
  steps: [
    "indexar-trechos",
    "marcar-caminho-excluido",
    "remover-trecho-antes-da-busca",
    "confirmar-busca-limpa",
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
