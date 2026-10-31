import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CUS-02: quando a pessoa invoca um comando local, o produto aplica a
// instrução declarada e mostra a origem do comando. Ordem verificada:
// invocação < instrução aplicada < origem mostrada. Superfícies são dados
// puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CUS-02 (customization);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "invocar-comando-local": [
    {
      kind: "event",
      name: "command-invoked",
      value: { command: "/revisar-arquivo" },
    },
  ],
  "aplicar-instrucao-declarada": [
    {
      kind: "state",
      name: "instruction-applied",
      value: { instruction: "listar os riscos antes do diff", applied: true },
    },
  ],
  "mostrar-origem": [
    {
      kind: "ui",
      name: "origin-shown",
      value: {
        source: "user-command",
        origin: "~/.openagent/commands/revisar-arquivo.md",
      },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CUS02_SCENARIO: DualScenario = {
  scenarioId: "cus-02-command-skill-plugin-origin",
  requirementId: "CUS-02",
  steps: [
    "invocar-comando-local",
    "aplicar-instrucao-declarada",
    "mostrar-origem",
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
