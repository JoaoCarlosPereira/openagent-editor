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
  /** Tokens estimados do rascunho da mensagem (API-03), zero quando ausente. */
  messageTokenCount: number;
  totalTokenCount: number;
  contextLimitTokens: number;
  withinLimit: boolean;
}

export type ContextTokenLimitInvalidResult = {
  valid: false;
  code: "INVALID_STATE";
  errors: string[];
};

export type ContextTokenLimitValidationResult =
  | { valid: true; value: number }
  | ContextTokenLimitInvalidResult;

export type ContextAttachmentInvalidResult = {
  valid: false;
  code: "INVALID_STATE";
  errors: string[];
};

export type ContextAttachmentValidationResult =
  | { valid: true; value: ContextAttachmentDraft }
  | ContextAttachmentInvalidResult;

/** Entrada para montar o payload enviado a uma API externa (PRV-01). */
export interface ContextExternalSendParams {
  attachments: unknown[];
  messageText?: string;
  /** Deve ser true após ação explícita de envio na UI/CLI. */
  explicitSendAcknowledged: boolean;
}

/** Conteúdo pronto para o gateway após confirmação explícita (PRV-01). */
export interface ContextExternalSendResult {
  /** Texto do usuário + blocos de contexto incluídos (sem caminhos excluídos). */
  content: string;
  includedPaths: string[];
  messageTokenCount: number;
  totalTokenCount: number;
  contextLimitTokens: number;
  withinLimit: boolean;
}
