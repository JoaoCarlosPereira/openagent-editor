/** Tipos de fonte de contexto anexável (CTX-01). */
export const CONTEXT_ATTACHMENT_KINDS = [
  "selection",
  "file",
  "folder",
  "symbol",
] as const;

export type ContextAttachmentKind = (typeof CONTEXT_ATTACHMENT_KINDS)[number];

/** Entrada bruta de anexo antes da prévia de envio. */
export interface ContextAttachmentDraft {
  id: string;
  kind: ContextAttachmentKind;
  /** Caminho canônico ou URI exibível da fonte. */
  path: string;
  /** Texto materializado para estimativa de tokens (seleção, arquivo ou símbolo). */
  previewText?: string;
  /** Nome do símbolo quando kind === "symbol". */
  symbolName?: string;
}

/** Fonte listada na prévia antes do envio ao gateway. */
export interface ContextAttachmentSource {
  id: string;
  kind: ContextAttachmentKind;
  label: string;
  path: string;
  previewText?: string;
  truncated: boolean;
  tokenCount: number;
}

/** Prévia agregada exibida antes do envio (CTX-01). */
export interface ContextSendPreview {
  sources: ContextAttachmentSource[];
  totalTokenCount: number;
  contextLimitTokens: number;
  withinLimit: boolean;
}

export type ContextAttachmentInvalidResult = {
  valid: false;
  code: "INVALID_STATE";
  errors: string[];
};

export type ContextAttachmentValidationResult =
  | { valid: true; value: ContextAttachmentDraft }
  | ContextAttachmentInvalidResult;
