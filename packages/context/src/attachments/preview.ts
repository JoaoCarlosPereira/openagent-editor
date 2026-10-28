import {
  estimateContextTokens,
  resolveContextTokenLimit,
  resolveStoredWorkspaceContextLimit,
} from "./tokens.js";
import type {
  ContextAttachmentDraft,
  ContextAttachmentSource,
  ContextSendPreview,
} from "./types.js";

const PREVIEW_CHAR_LIMIT = 12_000;

function truncatePreview(text: string): { text: string; truncated: boolean } {
  if (text.length <= PREVIEW_CHAR_LIMIT) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, PREVIEW_CHAR_LIMIT), truncated: true };
}

function labelForDraft(draft: ContextAttachmentDraft): string {
  if (draft.kind === "symbol" && draft.symbolName) {
    return `${draft.symbolName} (${draft.path})`;
  }
  if (draft.kind === "selection") {
    return `${draft.path} [seleção]`;
  }
  if (draft.kind === "folder") {
    return `${draft.path}/`;
  }
  return draft.path;
}

function tokenCountForDraft(draft: ContextAttachmentDraft): number {
  if (draft.kind === "folder") {
    return 0;
  }
  return estimateContextTokens(draft.previewText ?? "");
}

function sourceFromDraft(draft: ContextAttachmentDraft): ContextAttachmentSource {
  const label = labelForDraft(draft);
  const basePreview = draft.previewText ?? "";
  const { text: previewText, truncated } = truncatePreview(basePreview);

  const source: ContextAttachmentSource = {
    id: draft.id,
    kind: draft.kind,
    label,
    path: draft.path,
    truncated,
    tokenCount: tokenCountForDraft(draft),
  };

  if (previewText.length > 0) {
    source.previewText = previewText;
  }

  return source;
}

export interface BuildContextSendPreviewInput {
  attachments: ContextAttachmentDraft[];
  /** Rascunho da mensagem do usuário (tokenizado em API-03). */
  messageText?: string;
  /** Valor de workspace.context_limit quando persistido; null usa o default API-03. */
  workspaceContextLimitTokens?: number | null;
  /** Override explícito para a prévia (ex.: rascunho de configuração). */
  contextLimitTokens?: number;
}

function resolvePreviewContextLimit(input: BuildContextSendPreviewInput): number {
  if (input.contextLimitTokens !== undefined) {
    return resolveContextTokenLimit(input.contextLimitTokens);
  }
  return resolveStoredWorkspaceContextLimit(input.workspaceContextLimitTokens);
}

/**
 * Monta a prévia de envio: lista cada fonte com tokens estimados e o teto (CTX-01).
 */
export function buildContextSendPreview(
  input: BuildContextSendPreviewInput,
): ContextSendPreview {
  const contextLimitTokens = resolvePreviewContextLimit(input);
  const sources = input.attachments.map(sourceFromDraft);
  const attachmentTokenCount = sources.reduce((sum, row) => sum + row.tokenCount, 0);
  const messageTokenCount = estimateContextTokens(input.messageText ?? "");
  const totalTokenCount = attachmentTokenCount + messageTokenCount;

  return {
    sources,
    messageTokenCount,
    totalTokenCount,
    contextLimitTokens,
    withinLimit: totalTokenCount <= contextLimitTokens,
  };
}
