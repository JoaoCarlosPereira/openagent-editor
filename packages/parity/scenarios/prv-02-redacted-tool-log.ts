import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário PRV-02: o log padrão registra a ação da ferramenta e omite
// credencial, conteúdo de arquivo excluído e corpo bruto da resposta do
// modelo. Superfícies são dados puros de dry-drive, sem acoplamento a marca
// ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "executar-ferramenta": [
    {
      kind: "event",
      name: "tool-action-logged",
      value: { action: "file-edit", target: "src/service.ts", logged: true },
    },
  ],
  "escrever-log-padrão": [
    {
      kind: "state",
      name: "log-written",
      value: { channel: "padrão", entries: 1 },
    },
  ],
  "auditar-omissões-do-log": [
    {
      kind: "state",
      name: "credential-omitted",
      value: { "credential-in-log": false },
    },
    {
      kind: "state",
      name: "excluded-file-content-omitted",
      value: { path: "secrets/env.ts", "content-in-log": false },
    },
    {
      kind: "state",
      name: "raw-model-body-omitted",
      value: { "raw-response-body-in-log": false },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const PRV02_SCENARIO: DualScenario = {
  scenarioId: "prv-02-redacted-tool-log",
  requirementId: "PRV-02",
  steps: [
    "executar-ferramenta",
    "escrever-log-padrão",
    "auditar-omissões-do-log",
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
