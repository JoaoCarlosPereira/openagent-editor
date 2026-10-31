import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-03: quando a pessoa restaura um checkpoint, o produto reverte
// só os arquivos marcados como alteração daquela execução e, quando um
// arquivo marcado mudou fora da execução, reporta o conflito e não grava por
// cima. Ordem verificada: seleção do checkpoint < reversão dos arquivos
// marcados < relato do conflito sem sobrescrita. Superfícies são dados puros
// de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-03 (packages/storage/
// checkpoints); este cenário modela o contrato pelas tabelas de efeitos
// puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "selecionar-checkpoint": [
    {
      kind: "state",
      name: "checkpoint-selected",
      value: { checkpoint: "ckpt-runa-0004", run: "runa-0004", markedFiles: 3 },
    },
  ],
  "reverter-arquivos-marcados": [
    {
      kind: "state",
      name: "marked-files-reverted",
      value: {
        checkpoint: "ckpt-runa-0004",
        files: ["src/servico.ts", "src/regras.ts"],
        count: 2,
        onlyRunChanges: true,
      },
    },
  ],
  "reportar-conflito": [
    {
      kind: "ui",
      name: "restore-conflict-shown",
      value: {
        checkpoint: "ckpt-runa-0004",
        file: "src/indice.ts",
        conflict: "ALTERADO_APOS_A_EXECUCAO",
        overwritten: false,
        versionsShown: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES03_SCENARIO: DualScenario = {
  scenarioId: "ses-03-checkpoint-restore-conflict",
  requirementId: "SES-03",
  steps: [
    "selecionar-checkpoint",
    "reverter-arquivos-marcados",
    "reportar-conflito",
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
