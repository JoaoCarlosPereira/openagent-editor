import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário SES-04: quando a pessoa cria trabalho isolado, o produto usa um
// worktree local e mantém os arquivos do workspace original intactos até a
// aplicação escolhida. Ordem verificada: pedido de trabalho isolado <
// criação do worktree local < preservação do workspace original. Superfícies
// são dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de SES-04 (packages/tools/git);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "criar-trabalho-isolado": [
    {
      kind: "state",
      name: "isolated-work-requested",
      value: { workspace: "projeto-alfa" },
    },
  ],
  "criar-worktree-local": [
    {
      kind: "state",
      name: "worktree-created",
      value: {
        worktree: "worktrees/iso-001",
        base: "main",
        local: true,
      },
    },
  ],
  "preservar-workspace-original": [
    {
      kind: "state",
      name: "original-preserved",
      value: {
        workspace: "projeto-alfa",
        localChanges: 0,
        preserved: true,
        applyOnlyOnChoice: true,
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const SES04_SCENARIO: DualScenario = {
  scenarioId: "ses-04-worktree-isolation",
  requirementId: "SES-04",
  steps: [
    "criar-trabalho-isolado",
    "criar-worktree-local",
    "preservar-workspace-original",
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
