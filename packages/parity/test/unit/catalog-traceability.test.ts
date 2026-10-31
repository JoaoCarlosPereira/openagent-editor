import test from "node:test";
import assert from "node:assert/strict";
import { requirements, type Requirement } from "../../src/catalog.js";
import { catalogV1 } from "../fixtures/catalog-v1.js";

// NFC e espaços consecutivos são as únicas diferenças ignoradas.
function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function differences(actual: readonly Requirement[]): string[] {
  const issues: string[] = [];
  const byId = new Map<string, Requirement>();
  for (const requirement of actual) {
    if (byId.has(requirement.id)) issues.push(`ID duplicado: ${requirement.id}`);
    byId.set(requirement.id, requirement);
  }
  const expectedIds = new Set(catalogV1.map(([id]) => id));
  for (const [id, summary, criteria] of catalogV1) {
    const requirement = byId.get(id);
    if (!requirement) {
      issues.push(`ID ausente: ${id}`);
      continue;
    }
    if (normalize(requirement.summary) !== normalize(summary)) issues.push(`${id}: resumo alterado`);
    if (normalize(requirement.criteria) !== normalize(criteria)) issues.push(`${id}: critério alterado`);
  }
  for (const id of byId.keys()) {
    if (!expectedIds.has(id as (typeof catalogV1)[number][0])) issues.push(`ID inesperado: ${id}`);
  }
  return issues;
}

test("catálogo preserva IDs, significados e critérios da referência catalog-v1", () => {
  assert.equal(catalogV1.length, 53);
  assert.equal(new Set(catalogV1.map(([id]) => id)).size, 53);
  assert.equal(requirements.length, 53);
  assert.deepEqual(differences(requirements), []);
});

test("normalização é restrita a NFC e espaços", () => {
  assert.equal(normalize("  cafe\u0301 \n texto  "), "café texto");
  assert.notEqual(normalize("não executar"), normalize("executar"));
  assert.notEqual(normalize("Texto."), normalize("texto"));
});

test("detecta ID, significado e critério alterados, inclusive detalhes críticos", () => {
  for (const [id, detail] of [
    ["LOC-01", "ícone OpenAgent"],
    ["AGT-03", "diff agrupado"],
    ["DES-01", "modo desenho"],
  ] as const) {
    const item = requirements.find((requirement) => requirement.id === id);
    assert.ok(item);
    assert.ok(item.criteria.includes(detail), `${id}: detalhe ausente`);
    assert.ok(differences(requirements.map((r) => r.id === id
      ? { ...r, criteria: r.criteria.replace(detail, "") }
      : r)).includes(`${id}: critério alterado`));
    assert.ok(differences(requirements.map((r) => r.id === id
      ? { ...r, summary: "significado diferente" }
      : r)).includes(`${id}: resumo alterado`));
  }
  assert.ok(differences(requirements.slice(1)).includes("ID ausente: LOC-01"));
  const first = requirements[0];
  assert.ok(first);
  assert.ok(differences([...requirements, first]).includes("ID duplicado: LOC-01"));
  assert.ok(differences([...requirements, { ...first, id: "NEW-01" }]).includes("ID inesperado: NEW-01"));
});
