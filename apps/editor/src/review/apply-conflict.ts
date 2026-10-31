import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  buildApplyConflictView,
  type ApplyConflictViewEntry,
  type ApplyConflictViewSnapshot,
} from "./apply-conflict-view.js";

export type { ApplyConflictViewEntry, ApplyConflictViewSnapshot } from "./apply-conflict-view.js";
export { buildApplyConflictView } from "./apply-conflict-view.js";

export const APPLY_CONFLICT_DEFAULT_MESSAGE =
  "Conflito de versão: o arquivo mudou desde a geração da edição." as const;

export interface ApplyConflictEntry {
  relativePath: string;
  currentContent: string;
  proposedContent: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError("INVALID_STATE", `Campo '${field}' inválido no conflito.`, [field]);
  }
  return value;
}

function parseConflictJson(raw: string): ApplyConflictEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError("INVALID_STATE", "Payload de conflito não é JSON válido.", ["payload"]);
  }
  if (!isRecord(parsed)) {
    throw new ProtocolError("INVALID_STATE", "Payload de conflito inválido.", ["payload"]);
  }
  const relativePath = requireNonEmptyString(parsed.path ?? parsed.relativePath, "path");
  const currentContent = requireNonEmptyString(parsed.currentContent, "currentContent");
  const proposedContent = requireNonEmptyString(parsed.proposedContent, "proposedContent");
  return { relativePath, currentContent, proposedContent };
}

/** Extrai entrada ERR-01 de um ProtocolError CONFLICT (detalhe JSON em details). */
export function parseApplyConflictFromProtocolError(error: ProtocolError): ApplyConflictEntry {
  if (error.code !== PROTOCOL_ERROR_CODES.CONFLICT) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Esperado código CONFLICT para exibir conflito de aplicação.",
      [error.code],
    );
  }
  for (const detail of error.details) {
    const trimmed = detail.trim();
    if (trimmed.startsWith("{") && trimmed.includes("currentContent")) {
      return parseConflictJson(trimmed);
    }
  }
  throw new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    "Detalhe de conflito ERR-01 ausente no erro de protocolo.",
    error.details,
  );
}

function normalizeEntries(entries: readonly ApplyConflictEntry[]): ApplyConflictViewEntry[] {
  if (entries.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Conflito ERR-01 exige ao menos um arquivo.",
      ["entries"],
    );
  }
  return entries.map((entry) => ({
    relativePath: entry.relativePath,
    currentContent: entry.currentContent,
    proposedContent: entry.proposedContent,
  }));
}

/**
 * ERR-01: impede aplicação direta e expõe as duas versões na UI de revisão.
 */
export class ApplyConflictController {
  private view: ApplyConflictViewSnapshot | undefined;

  get isOpen(): boolean {
    return this.view !== undefined;
  }

  get snapshot(): ApplyConflictViewSnapshot | undefined {
    return this.view;
  }

  present(
    entries: readonly ApplyConflictEntry[],
    message: string = APPLY_CONFLICT_DEFAULT_MESSAGE,
  ): ApplyConflictViewSnapshot {
    this.view = buildApplyConflictView({
      message,
      entries: normalizeEntries(entries),
    });
    return this.view;
  }

  presentFromProtocolError(error: ProtocolError): ApplyConflictViewSnapshot {
    return this.present([parseApplyConflictFromProtocolError(error)], error.message);
  }

  /** Aplicação direta permanece bloqueada enquanto o conflito estiver aberto. */
  assertApplyBlocked(): void {
    if (!this.view) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Nenhum conflito aberto para revisar.",
        [],
      );
    }
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.CONFLICT,
      APPLY_CONFLICT_DEFAULT_MESSAGE,
      this.view.accessible.entries.map((entry) =>
        JSON.stringify({
          path: entry.relativePath,
          currentContent: entry.currentContent,
          proposedContent: entry.proposedContent,
        }),
      ),
    );
  }

  dismiss(): void {
    this.view = undefined;
  }
}
