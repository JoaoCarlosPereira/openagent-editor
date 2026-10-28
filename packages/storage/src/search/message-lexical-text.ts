import type { DatabaseSync } from "node:sqlite";
import { readCasBlob } from "../cas.js";

/**
 * Resolve texto buscável a partir de um contentRef CAS (JSON { text } ou UTF-8 bruto).
 */
export function lexicalTextFromContentRef(
  database: DatabaseSync,
  casRoot: string,
  contentRef: string,
): string {
  const bytes = readCasBlob(database, casRoot, contentRef);
  const raw = Buffer.from(bytes).toString("utf8");
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // Conteúdo textual bruto no CAS.
  }
  return raw;
}
