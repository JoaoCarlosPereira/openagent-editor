import { requirementIds } from "./catalog.js";

export interface ParityValidationResult {
  valid: boolean;
  totalRequired: number;
  totalFound: number;
  missingIds: string[];
  duplicateIds: string[];
}

export function validateRequirementCatalog(idsToCheck: string[] = requirementIds): ParityValidationResult {
  const presentSet = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of idsToCheck) {
    if (presentSet.has(id)) {
      duplicates.add(id);
    }
    presentSet.add(id);
  }

  const missingIds = requirementIds.filter((id) => !presentSet.has(id));

  return {
    valid: missingIds.length === 0 && duplicates.size === 0,
    totalRequired: requirementIds.length,
    totalFound: presentSet.size,
    missingIds,
    duplicateIds: Array.from(duplicates),
  };
}

export function formatParityReport(result: ParityValidationResult): string {
  const lines: string[] = [
    "=== Relatório de Paridade dos Requisitos (PRD / TechSpec) ===",
    `Total obrigatório: ${result.totalRequired}`,
    `Total encontrado:    ${result.totalFound}`,
    `Status:             ${result.valid ? "APROVADO (53/53 presentes)" : "FALHA"}`,
  ];

  if (result.duplicateIds.length > 0) {
    lines.push(`IDs duplicados (${result.duplicateIds.length}): ${result.duplicateIds.join(", ")}`);
  }

  if (result.missingIds.length > 0) {
    lines.push(`IDs ausentes (${result.missingIds.length}): ${result.missingIds.join(", ")}`);
  }

  return lines.join("\n");
}
