import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário CUS-01: quando uma sessão começa, o produto carrega as regras de
// usuário e de projeto aplicáveis e mostra a origem de cada uma. Ordem
// verificada: início da sessão < regras do usuário < regras do projeto <
// origem visível para todas. Superfícies são dados puros de dry-drive, sem
// acoplamento a marca ou binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de CUS-01 (customization);
// este cenário modela o contrato pelas tabelas de efeitos puros (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "iniciar-sessao": [
    {
      kind: "state",
      name: "session-started",
      value: { workspace: "projeto-alfa" },
    },
  ],
  "carregar-regras-do-usuario": [
    {
      kind: "ui",
      name: "rule-loaded",
      value: { source: "user", origin: "~/.openagent/rules.md", rules: 12 },
    },
  ],
  "carregar-regras-do-projeto": [
    {
      kind: "ui",
      name: "rule-loaded",
      value: { source: "project", origin: ".openagent/rules.md", rules: 8 },
    },
  ],
  "mostrar-origem-de-cada-regra": [
    {
      kind: "ui",
      name: "rules-with-origin-shown",
      value: { total: 20, "every-rule-has-origin": true },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const CUS01_SCENARIO: DualScenario = {
  scenarioId: "cus-01-user-project-rules",
  requirementId: "CUS-01",
  steps: [
    "iniciar-sessao",
    "carregar-regras-do-usuario",
    "carregar-regras-do-projeto",
    "mostrar-origem-de-cada-regra",
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
