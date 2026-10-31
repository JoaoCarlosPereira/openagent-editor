import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário ERR-01: quando um arquivo muda entre a geração do patch e a
// aplicação, o produto impede a aplicação direta e mostra as duas versões
// (a versionada na geração e a atual em disco). Ordem verificada: patch
// gerado < mudança externa do arquivo < bloqueio da aplicação direta <
// exibição das duas versões. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de ERR-01 (packages/tools/
// src/files + apps/editor/src/review); este cenário modela o contrato pelas
// tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "gerar-patch": [
    {
      kind: "diff",
      name: "patch-generated",
      value: { file: "src/servico.ts", changes: 8, baseHash: "a1b2c3" },
    },
  ],
  "mudar-arquivo-fora": [
    {
      kind: "state",
      name: "file-changed-externally",
      value: { file: "src/servico.ts", changedAfterGeneration: true, diskHash: "d4e5f6" },
    },
  ],
  "bloquear-aplicacao-direta": [
    {
      kind: "ui",
      name: "direct-apply-blocked",
      value: { file: "src/servico.ts", blocked: true, overwritten: false },
    },
  ],
  "mostrar-duas-versoes": [
    {
      kind: "ui",
      name: "both-versions-shown",
      value: {
        file: "src/servico.ts",
        generatedVersion: "a1b2c3",
        currentVersion: "d4e5f6",
        bothVisible: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const ERR01_SCENARIO: DualScenario = {
  scenarioId: "err-01-file-changed-conflict-versions",
  requirementId: "ERR-01",
  steps: [
    "gerar-patch",
    "mudar-arquivo-fora",
    "bloquear-aplicacao-direta",
    "mostrar-duas-versoes",
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
