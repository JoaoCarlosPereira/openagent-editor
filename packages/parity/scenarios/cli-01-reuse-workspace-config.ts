import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CLI-01: quando a pessoa inicia a CLI num workspace, o produto
// reutiliza provedor, modo, regras, MCP e sessões daquele workspace. Ordem
// verificada: início < provedor < modo < regras < MCP < sessões. Superfícies
// são dados puros de dry-drive, sem acoplamento a marca ou binários do Cursor
// (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CLI-01 (apps/cli + daemon);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "iniciar-cli-no-workspace": [
    {
      kind: "event",
      name: "cli-started",
      value: { workspace: "projeto-alfa" },
    },
  ],
  "reutilizar-provedor": [
    {
      kind: "ui",
      name: "provider-reused",
      value: { provider: "local", "same-as-editor": true },
    },
  ],
  "reutilizar-modo": [
    {
      kind: "ui",
      name: "mode-reused",
      value: { mode: "agent", "same-as-editor": true },
    },
  ],
  "reutilizar-regras": [
    {
      kind: "ui",
      name: "rules-reused",
      value: { count: 20, "same-as-editor": true },
    },
  ],
  "reutilizar-mcp": [
    {
      kind: "ui",
      name: "mcp-reused",
      value: { servers: 1, "same-as-editor": true },
    },
  ],
  "reutilizar-sessoes": [
    {
      kind: "ui",
      name: "sessions-reused",
      value: { sessions: 3, "same-as-editor": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CLI01_SCENARIO: DualScenario = {
  scenarioId: "cli-01-reuse-workspace-config",
  requirementId: "CLI-01",
  steps: [
    "iniciar-cli-no-workspace",
    "reutilizar-provedor",
    "reutilizar-modo",
    "reutilizar-regras",
    "reutilizar-mcp",
    "reutilizar-sessoes",
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
