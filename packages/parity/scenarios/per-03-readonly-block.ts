import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PER-03: enquanto o modo de execução for Somente leitura, gravação
// de arquivo e comando que altere o workspace são bloqueados com a mensagem
// "Bloqueado pelo modo de execução.". Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const readOnlyMessage = "Bloqueado pelo modo de execução.";

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "ativar-somente-leitura": [
    {
      kind: "state",
      name: "readonly-mode-active",
      value: { mode: "readonly", active: true },
    },
  ],
  "gravar-arquivo": [
    {
      kind: "error",
      name: "file-write-blocked",
      value: { code: "PERMISSION_DENIED", action: "file-write", message: readOnlyMessage },
    },
  ],
  "executar-comando-mutavel": [
    {
      kind: "error",
      name: "mutating-command-blocked",
      value: { code: "PERMISSION_DENIED", action: "shell-command", message: readOnlyMessage },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PER03_SCENARIO: DualScenario = {
  scenarioId: "per-03-readonly-block",
  requirementId: "PER-03",
  steps: [
    "ativar-somente-leitura",
    "gravar-arquivo",
    "executar-comando-mutavel",
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
