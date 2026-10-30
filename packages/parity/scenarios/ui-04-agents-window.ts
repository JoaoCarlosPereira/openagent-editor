import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário UI-04: a janela de agentes lista execuções locais em paralelo e
// oferece o comando de voltar ao editor no mesmo workspace. Superfícies são
// dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).

const effects: Record<string, readonly CaptureEffect[]> = {
  "abrir-janela-de-agentes": [
    { kind: "ui", name: "agents-window", value: { open: true } },
  ],
  "listar-execucoes-locais-em-paralelo": [
    {
      kind: "ui",
      name: "parallel-local-runs",
      value: { runs: 2, "isolated-agents": true },
    },
  ],
  "voltar-ao-editor": [
    {
      kind: "state",
      name: "back-to-editor",
      value: { "same-workspace": true },
    },
  ],
};

export const UI04_SCENARIO: DualScenario = {
  scenarioId: "ui-04-agents-window",
  requirementId: "UI-04",
  steps: [
    "abrir-janela-de-agentes",
    "listar-execucoes-locais-em-paralelo",
    "voltar-ao-editor",
  ],
  cursor: {
    product: "cursor",
    productVersion: FROZEN_CURSOR_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects,
  },
  openagent: {
    product: "openagent",
    productVersion: OPENAGENT_VERSION,
    platform: "linux",
    model: null,
    provider: null,
    effects,
  },
};
