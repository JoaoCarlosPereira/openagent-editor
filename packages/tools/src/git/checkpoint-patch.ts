export type CheckpointPatchFileChange = {
  relativePath: string;
  baseContent: string;
  resultContent: string;
};

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
    const pathLabel = change.relativePath.trim();
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

export type ParsedCheckpointPatchEntry = {
  relativePath: string;
  baseContent: string;
  resultContent: string;
};

function parseDiffPathHeader(line: string, prefix: "--- a/" | "+++ b/"): string | null {
  if (!line.startsWith(prefix)) {
    return null;
  }
  const path = line.slice(prefix.length).trim();
  return path.length > 0 ? path : null;
}

/**
 * Interpreta patch persistido em patchRef (formato de buildCheckpointPatchFromFileChanges).
 */
export function parseCheckpointPatchText(patchText: string): ParsedCheckpointPatchEntry[] {
  const trimmed = patchText.trim();
  if (!trimmed) {
    throw new Error("Patch de checkpoint vazio.");
  }

  const sections = trimmed.split(/\n\n+/);
  const entries: ParsedCheckpointPatchEntry[] = [];

  for (const section of sections) {
    const lines = section.split("\n");
    if (lines.length < 3) {
      throw new Error("Patch de checkpoint inválido.");
    }
    const oldPath = parseDiffPathHeader(lines[0] ?? "", "--- a/");
    const newPath = parseDiffPathHeader(lines[1] ?? "", "+++ b/");
    if (!oldPath || !newPath || oldPath !== newPath) {
      throw new Error("Patch de checkpoint inválido.");
    }
    if (!(lines[2] ?? "").startsWith("@@")) {
      throw new Error("Patch de checkpoint inválido.");
    }

    const baseLines: string[] = [];
    const resultLines: string[] = [];
    for (const line of lines.slice(3)) {
      if (line.startsWith("-")) {
        baseLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        resultLines.push(line.slice(1));
      } else if (line.length > 0) {
        throw new Error("Patch de checkpoint inválido.");
      }
    }

    entries.push({
      relativePath: oldPath,
      baseContent: baseLines.join("\n"),
      resultContent: resultLines.join("\n"),
    });
  }

  if (entries.length === 0) {
    throw new Error("Patch de checkpoint inválido.");
  }

  return entries;
}
