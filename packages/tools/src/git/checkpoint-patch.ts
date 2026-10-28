export type CheckpointPatchFileChange = {
  relativePath: string;
  baseContent: string;
  resultContent: string;
};

function escapePathForDiffHeader(relativePath: string): string {
  return relativePath.replace(/\s/g, "_");
}

/**
 * Gera patch textual agrupado (estilo unified diff simplificado) para persistência em patchRef.
 */
export function buildCheckpointPatchFromFileChanges(
  changes: CheckpointPatchFileChange[],
): string {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("Alterações de checkpoint inválidas.");
  }

  const sections: string[] = [];
  for (const change of changes) {
    if (typeof change.relativePath !== "string" || !change.relativePath.trim()) {
      throw new Error("Alterações de checkpoint inválidas.");
    }
    const pathLabel = escapePathForDiffHeader(change.relativePath.trim());
    const baseLines = change.baseContent.split("\n");
    const resultLines = change.resultContent.split("\n");
    sections.push(
      [
        `--- a/${pathLabel}`,
        `+++ b/${pathLabel}`,
        `@@ base ${baseLines.length} result ${resultLines.length} @@`,
        ...baseLines.map((line) => `-${line}`),
        ...resultLines.map((line) => `+${line}`),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}
