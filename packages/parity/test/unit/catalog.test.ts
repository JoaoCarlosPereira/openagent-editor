import test from "node:test";
import assert from "node:assert/strict";
import { requirements, requirementIds } from "../../src/catalog.js";
import { validateRequirementCatalog, formatParityReport } from "../../src/report.js";

const EXPECTED_IDS = [
  "LOC-01",
  "UI-01",
  "UI-02",
  "UI-03",
  "UI-04",
  "AGT-01",
  "AGT-02",
  "AGT-03",
  "AGT-04",
  "AGT-05",
  "AGT-06",
  "AGT-07",
  "PRJ-01",
  "PER-01",
  "PER-02",
  "PER-03",
  "STA-01",
  "VAL-01",
  "CTX-01",
  "CTX-02",
  "CTX-03",
  "CTX-04",
  "PRV-01",
  "PRV-02",
  "TAB-01",
  "TAB-02",
  "TAB-03",
  "INL-01",
  "INL-02",
  "AUT-01",
  "AUT-02",
  "DES-01",
  "CAN-01",
  "CUS-01",
  "CUS-02",
  "CUS-03",
  "MCP-01",
  "CLI-01",
  "CLI-02",
  "SES-01",
  "SES-02",
  "SES-03",
  "SES-04",
  "SES-05",
  "SES-06",
  "SES-07",
  "API-01",
  "API-02",
  "API-03",
  "ERR-01",
  "ERR-02",
  "ERR-03",
  "ERR-04",
];

test("Catálogo contém exatamente 53 requisitos definidos no PRD/TechSpec", () => {
  assert.equal(requirements.length, 53, "O catálogo deve ter exatamente 53 requisitos");
  assert.equal(requirementIds.length, 53, "A lista de IDs deve ter exatamente 53 entradas");
});

test("Todos os 53 requisitos obrigatórios estão presentes no catálogo", () => {
  const catalogIds = new Set(requirementIds);
  for (const expectedId of EXPECTED_IDS) {
    assert.ok(catalogIds.has(expectedId), `Requisito obrigatório ${expectedId} deve estar no catálogo`);
  }
});

test("Nenhum ID está duplicado no catálogo", () => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of requirementIds) {
    if (seen.has(id)) {
      duplicates.push(id);
    }
    seen.add(id);
  }
  assert.deepEqual(duplicates, [], "Não deve haver IDs duplicados no catálogo");
});

test("Cada requisito possui campos estruturados válidos (id, category, summary, criteria)", () => {
  for (const req of requirements) {
    assert.ok(typeof req.id === "string" && req.id.length > 0, `ID inválido para ${req.id}`);
    assert.ok(typeof req.category === "string" && req.category.length > 0, `Categoria inválida para ${req.id}`);
    assert.ok(typeof req.summary === "string" && req.summary.length > 0, `Resumo inválido para ${req.id}`);
    assert.ok(typeof req.criteria === "string" && req.criteria.length > 0, `Critérios inválidos para ${req.id}`);
    assert.equal(req.id, `${req.category}-${req.id.split("-")[1]}`, `ID ${req.id} deve ser prefixado pela categoria ${req.category}`);
  }
});

test("validateRequirementCatalog aprova quando todos os 53 IDs estão presentes", () => {
  const result = validateRequirementCatalog(requirementIds);
  assert.equal(result.valid, true, "Deve ser válido quando todos os IDs estão presentes");
  assert.equal(result.totalRequired, 53);
  assert.equal(result.totalFound, 53);
  assert.deepEqual(result.missingIds, []);
  assert.deepEqual(result.duplicateIds, []);
});

test("validateRequirementCatalog falha quando falta um ID obrigatório", () => {
  const subset = requirementIds.filter((id) => id !== "LOC-01");
  const result = validateRequirementCatalog(subset);
  assert.equal(result.valid, false, "Deve falhar quando falta LOC-01");
  assert.equal(result.totalRequired, 53);
  assert.equal(result.totalFound, 52);
  assert.deepEqual(result.missingIds, ["LOC-01"]);
});

test("validateRequirementCatalog falha quando há IDs duplicados", () => {
  const withDuplicate = [...requirementIds, "AGT-01"];
  const result = validateRequirementCatalog(withDuplicate);
  assert.equal(result.valid, false, "Deve falhar quando há duplicações");
  assert.deepEqual(result.duplicateIds, ["AGT-01"]);
});

test("formatParityReport formata saída com sucesso ou com IDs ausentes", () => {
  const okResult = validateRequirementCatalog(requirementIds);
  const okText = formatParityReport(okResult);
  assert.match(okText, /APROVADO \(53\/53 presentes\)/);

  const failResult = validateRequirementCatalog(["LOC-01"]);
  const failText = formatParityReport(failResult);
  assert.match(failText, /FALHA/);
  assert.match(failText, /IDs ausentes \(52\):/);
});
