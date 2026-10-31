import type { CaptureEffect, DualScenario } from "../src/dual-driver.js";
import { OPENAGENT_VERSION, FROZEN_CURSOR_VERSION } from "../src/dual-driver.js";

// Cenário MCP-01: quando a pessoa configura um servidor MCP por stdio ou
// HTTP, o produto lista as ferramentas, executa a escolhida somente depois de
// permissão e mostra o resultado (ou o erro) da ferramenta. Ordem verificada:
// configuração < listagem < pedido de permissão < execução < resultado.
// Superfícies são dados puros de dry-drive, sem acoplamento a marca ou
// binários do Cursor (ADR-002/ADR-007).
//
// Nota: o aceite real depende da implementação de MCP-01 (tools/mcp +
// policy); este cenário modela o contrato pelas tabelas de efeitos puros
// (dry-drive).

const cursorEffects: Record<string, readonly CaptureEffect[]> = {
  "configurar-servidor-mcp": [
    {
      kind: "state",
      name: "mcp-server-configured",
      value: { name: "banco-local", transports: ["stdio", "http"] },
    },
  ],
  "listar-ferramentas": [
    {
      kind: "ui",
      name: "mcp-tools-listed",
      value: { server: "banco-local", tools: 4 },
    },
  ],
  "pedir-permissao-da-ferramenta": [
    {
      kind: "ui",
      name: "permission-requested",
      value: { tool: "consultar-cliente", scope: "mcp-call" },
    },
  ],
  "executar-ferramenta-escolhida": [
    {
      kind: "event",
      name: "tool-executed",
      value: { server: "banco-local", tool: "consultar-cliente", "after-permission": true },
    },
  ],
  "mostrar-resultado-ou-erro": [
    {
      kind: "ui",
      name: "tool-result-shown",
      value: { tool: "consultar-cliente", ok: true, result: "1 cliente encontrado" },
    },
  ],
};

const openagentEffects: Record<string, readonly CaptureEffect[]> = {
  ...cursorEffects,
};

export const MCP01_SCENARIO: DualScenario = {
  scenarioId: "mcp-01-mcp-tools-permission",
  requirementId: "MCP-01",
  steps: [
    "configurar-servidor-mcp",
    "listar-ferramentas",
    "pedir-permissao-da-ferramenta",
    "executar-ferramenta-escolhida",
    "mostrar-resultado-ou-erro",
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
