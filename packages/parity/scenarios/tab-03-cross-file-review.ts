import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário TAB-03: quando a sugestão altera outro arquivo, o produto mostra o
// caminho do arquivo afetado e aplica só depois de revisão. Ordem verificada:
// caminho exibido < revisão < aplicação. Superfícies são dados puros de
// dry-drive, sem acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "gerar-sugestao-que-altera-outro-arquivo": [
    {
      kind: "diff",
      name: "cross-file-change",
      value: { "current-file": "src/service.ts", "affected-files": ["src/lib/handler.ts"] },
    },
  ],
  "mostrar-caminho-do-arquivo-afetado": [
    {
      kind: "ui",
      name: "affected-path-shown",
      value: { target: "src/lib/handler.ts", visible: true },
    },
  ],
  "revisar-diff-do-outro-arquivo": [
    {
      kind: "state",
      name: "review-required",
      value: { required: true, "applied-before-review": false },
    },
  ],
  "aplicar-somente-apos-revisao": [
    {
      kind: "state",
      name: "applied-after-review",
      value: { applied: true, after: "review", target: "src/lib/handler.ts" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const TAB03_SCENARIO: DualScenario = {
  scenarioId: "tab-03-cross-file-review",
  requirementId: "TAB-03",
  steps: [
    "gerar-sugestao-que-altera-outro-arquivo",
    "mostrar-caminho-do-arquivo-afetado",
    "revisar-diff-do-outro-arquivo",
    "aplicar-somente-apos-revisao",
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
