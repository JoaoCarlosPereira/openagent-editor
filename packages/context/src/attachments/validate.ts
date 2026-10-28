import { PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  CONTEXT_ATTACHMENT_KINDS,
  type ContextAttachmentDraft,
  type ContextAttachmentKind,
  type ContextAttachmentInvalidResult,
  type ContextAttachmentValidationResult,
} from "./types.js";

function invalidAttachment(errors: string[]): ContextAttachmentInvalidResult {
  return {
    valid: false,
    code: PROTOCOL_ERROR_CODES.INVALID_STATE,
    errors,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseKind(raw: unknown): ContextAttachmentKind | null {
  if (typeof raw !== "string") {
    return null;
  }
  const kind = raw.trim() as ContextAttachmentKind;
  return (CONTEXT_ATTACHMENT_KINDS as readonly string[]).includes(kind) ? kind : null;
}

/**
 * Valida um rascunho de anexo de contexto.
 * Entrada inválida retorna INVALID_STATE sem efeito colateral (CTX-01 caminho de erro).
 */
export function validateContextAttachmentDraft(
  raw: unknown,
): ContextAttachmentValidationResult {
  if (!isRecord(raw)) {
    return invalidAttachment(["Anexo de contexto deve ser um objeto JSON não-nulo."]);
  }

  const errors: string[] = [];

  if (!isNonEmptyString(raw["id"])) {
    errors.push("Campo 'id' ausente ou inválido (string não-vazia).");
  }

  const kind = parseKind(raw["kind"]);
  if (kind === null) {
    errors.push(
      `Campo 'kind' deve ser um de: ${CONTEXT_ATTACHMENT_KINDS.join(", ")}.`,
    );
  }

  if (!isNonEmptyString(raw["path"])) {
    errors.push("Campo 'path' ausente ou inválido (string não-vazia).");
  }

  if ("previewText" in raw && raw["previewText"] !== undefined && typeof raw["previewText"] !== "string") {
    errors.push("Campo 'previewText' deve ser string quando presente.");
  }

  if ("symbolName" in raw && raw["symbolName"] !== undefined && !isNonEmptyString(raw["symbolName"])) {
    errors.push("Campo 'symbolName' deve ser string não-vazia quando presente.");
  }

  if (kind === "symbol" && !isNonEmptyString(raw["symbolName"])) {
    errors.push("Anexo 'symbol' exige 'symbolName' não-vazio.");
  }

  if (errors.length > 0) {
    return invalidAttachment(errors);
  }

  const draft: ContextAttachmentDraft = {
    id: (raw["id"] as string).trim(),
    kind: kind as ContextAttachmentKind,
    path: (raw["path"] as string).trim(),
  };

  if (typeof raw["previewText"] === "string") {
    draft.previewText = raw["previewText"];
  }
  if (typeof raw["symbolName"] === "string") {
    draft.symbolName = raw["symbolName"].trim();
  }

  return { valid: true, value: draft };
}

export type ContextAttachmentListValidationResult =
  | { valid: true; value: ContextAttachmentDraft[] }
  | { valid: false; code: "INVALID_STATE"; errors: string[] };

export function parseContextAttachmentDrafts(
  raw: unknown,
): ContextAttachmentListValidationResult {
  if (raw === undefined) {
    return { valid: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return invalidAttachment(["Lista de anexos deve ser um array quando presente."]);
  }

  const parsed: ContextAttachmentDraft[] = [];
  for (const item of raw) {
    const result = validateContextAttachmentDraft(item);
    if (!result.valid) {
      return invalidAttachment(result.errors);
    }
    parsed.push(result.value);
  }
  return { valid: true, value: parsed };
}
