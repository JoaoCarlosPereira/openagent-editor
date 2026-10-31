#!/usr/bin/env node
/**
 * task_198 — Gerador da preparação do aceite manual (UAT) 53/53.
 *
 * Lê o catálogo canônico dos 53 requisitos (packages/parity/src/catalog.ts)
 * e os cenários diferenciais dry-drive (packages/parity/src/scenarios.ts,
 * cobertura 53/53) e gera os artefatos de preparação do aceite:
 *   packages/parity/report/uat-checklist.md    checklist humano (pessoa preenche)
 *   packages/parity/report/uat-checklist.json  estado machine-readable
 *
 * O checklist registra PREPARAÇÃO: cada linha traz ID → critério canônico →
 * passos observáveis → evidência esperada (efeitos por passo). A execução
 * humana do UAT (pessoa, máquina limpa, relatando passo/resultado/evidência)
 * NÃO é substituída por este artefato.
 *
 * Uso: node --import tsx scripts/uat-checklist.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const runnerCode = `
import { requirements, requirementIds } from "./packages/parity/src/catalog.js";
import { EDITOR_REQUIREMENT_IDS, EDITOR_SCENARIOS } from "./packages/parity/src/scenarios.js";
const rows = requirements.map((req) => {
  const scenario = EDITOR_SCENARIOS.find((s) => s.requirementId === req.id) ?? null;
  const expectedEffects = scenario
    ? Object.fromEntries(scenario.steps.map((step) => [
        step,
        [
          ...new Set([
            ...(scenario.cursor.effects[step] ?? []).map((e) => e.name),
            ...(scenario.openagent.effects[step] ?? []).map((e) => e.name),
          ]),
        ],
      ]))
    : null;
  return {
    id: req.id,
    category: req.category,
    summary: req.summary,
    criteria: req.criteria,
    scenarioId: scenario ? scenario.scenarioId : null,
    scenarioPath: scenario ? "packages/parity/scenarios/" + scenario.scenarioId + ".ts" : null,
    steps: scenario ? [...scenario.steps] : [],
    expectedEffects,
  };
});
console.log(JSON.stringify({ total: requirementIds.length, scenarioCount: EDITOR_REQUIREMENT_IDS.length, requirements: rows }));
`;

const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--input-type=module", "-e", runnerCode],
  {
    cwd: rootDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: childEnv,
    encoding: "utf8",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const data = JSON.parse(result.stdout);

// Guard rails: o checklist só é gerado se a matriz canônica estiver inteira
// e coberta 1:1 pelos cenários dry-drive.
if (data.total !== 53 || data.scenarioCount !== 53) {
  console.error(`matriz canônica incompleta: requisitos=${data.total}, cenários=${data.scenarioCount} (esperado 53/53)`);
  process.exit(1);
}
const missingScenario = data.requirements.filter((row) => !row.scenarioId || row.steps.length === 0 || !row.expectedEffects);
if (missingScenario.length > 0) {
  console.error(`requisitos sem cenário dry-drive: ${missingScenario.map((r) => r.id).join(", ")}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const reportPath = path.join(rootDir, "packages", "parity", "report");
fs.mkdirSync(reportPath, { recursive: true });

fs.writeFileSync(
  path.join(reportPath, "uat-checklist.json"),
  JSON.stringify({
    _preparacao: "Preparação do aceite manual (UAT) 53/53, gerada por scripts/uat-checklist.mjs. Não constitui aceite executado.",
    _fontes: ["packages/parity/src/catalog.ts", "packages/parity/src/scenarios.ts"],
    generatedOn: today,
    total: data.total,
    requirements: data.requirements,
  }, null, 2) + "\n",
);

const header = `# Preparação do aceite manual (UAT) — 53/53 requisitos

**Status: PREPARAÇÃO.** Este checklist organiza a execução do aceite manual;
não constitui aceite executado. A pessoa executora preenche, para cada ID:
passo realizado, resultado observado e evidência (SO, versão do produto,
versão do Cursor de referência, provedor/fixture).

- Fonte dos critérios: \`packages/parity/src/catalog.ts\` (matriz canônica do PRD v6, gate único 53/53).
- Fonte dos passos: cenários diferenciais dry-drive em \`packages/parity/scenarios/\` (cobertura 53/53, task_188–task_197).
- Evidência esperada: nomes dos efeitos observáveis declarados pelo cenário dry-drive por passo, nos dois lados (Cursor 3.24.18 congelado e OpenAgent). Na execução real, a pessoa deve observar o equivalente visível desses efeitos e registrar captura/log.
- Gerada em: ${today} por \`node --import tsx scripts/uat-checklist.mjs\`.

## Como executar o aceite (roteiro da pessoa)

1. Instalar o pacote Linux em máquina limpa conforme o roteiro de instalação (ver \`docs/parity-acceptance.md\`, seção "Preparação do aceite manual 53/53 — Linux (task_198)").
2. Abrir o editor e, para cada ID abaixo, executar os passos na ordem do cenário e registrar o resultado na coluna \`Resultado/evidência\`.
3. Procurar os efeitos esperados indicados na coluna "Evidência esperada" (diferença observável na UI, arquivo, terminal, log ou estado).
4. Salvar o preenchimento em \`packages/parity/report/uat-<so>-<data>.md\` e referenciar no card da tarefa.
5. Um requisito só fica aceito quando o fluxo principal **e** o caso de erro correspondente passam no produto instalado.

`;

const categoryTitles = {
  LOC: "Editor base",
  UI: "Interface",
  AGT: "Agente",
  PRJ: "Projeto",
  PER: "Permissão",
  STA: "Estado de execução",
  VAL: "Validação de entrada",
  CTX: "Contexto e índice",
  PRV: "Privacidade e log",
  TAB: "Autocomplete (Tab)",
  INL: "Edição inline",
  AUT: "Automação local",
  DES: "Desenho",
  CAN: "Canvas",
  CUS: "Regras, customização e hooks",
  MCP: "MCP",
  CLI: "CLI e daemon",
  SES: "Sessões",
  API: "Provedores e API",
  ERR: "Casos de borda e erro",
};

let md = header;
const categories = [...new Set(data.requirements.map((r) => r.category))];
for (const category of categories) {
  const rows = data.requirements.filter((r) => r.category === category);
  md += `## ${category} — ${categoryTitles[category] ?? category}\n\n`;
  md += "| ID | Critério (catálogo canônico) | Passos observáveis | Evidência esperada | Resultado/evidência (pessoa) |\n";
  md += "|---|---|---|---|---|\n";
  for (const row of rows) {
    const steps = row.steps.join("<br>");
    const evidence = Object.entries(row.expectedEffects)
      .map(([step, names]) => `${step} → ${names.join(", ")}`)
      .join("<br>");
    md += `| ${row.id} | ${row.criteria} | ${steps} | ${evidence} | |\n`;
  }
  md += "\n";
}

md += `## Contagem e integridade do checklist

- Requisitos do catálogo canônico: ${data.total}.
- Requisitos com cenário dry-drive com passos e efeitos declarados: ${data.total - missingScenario.length}/${data.total}.
- Requisitos com cenário faltando/vazio: ${missingScenario.length} (geração falha se > 0).

Este arquivo é etapa de PREPARAÇÃO (task_198); nenhum ID é liberado pelo preenchimento programático — o aceite é a execução humana em pacote limpo, conforme ADR-001 e o roteiro acima.
`;

fs.writeFileSync(path.join(reportPath, "uat-checklist.md"), md);

console.log(`preparação do UAT gerada: ${path.relative(rootDir, path.join(reportPath, "uat-checklist.md"))}`);
console.log(`estado machine-readable: ${path.relative(rootDir, path.join(reportPath, "uat-checklist.json"))}`);
console.log(`requisitos: ${data.total}/53 com cenário dry-drive e evidência esperada por passo`);
