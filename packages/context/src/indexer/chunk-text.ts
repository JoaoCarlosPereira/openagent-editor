import type { ContextIndexChunk } from "./types.js";

export const DEFAULT_CONTEXT_INDEX_CHUNK_SIZE = 4_000;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Divide texto em chunks contíguos para indexação FTS5 (CTX-02).
 */
export function chunkContextFileText(
  content: string,
  chunkSize = DEFAULT_CONTEXT_INDEX_CHUNK_SIZE,
): ContextIndexChunk[] {
  if (!isPositiveInteger(chunkSize)) {
    throw new Error("chunkSize inválido para indexação de contexto.");
  }
  if (content.length === 0) {
    return [];
  }

  const chunks: ContextIndexChunk[] = [];
  let chunkIndex = 0;
  for (let start = 0; start < content.length; start += chunkSize) {
    const end = Math.min(content.length, start + chunkSize);
    chunks.push({
      chunkIndex,
      charStart: start,
      charEnd: end,
      lexicalText: content.slice(start, end),
    });
    chunkIndex += 1;
  }
  return chunks;
}
