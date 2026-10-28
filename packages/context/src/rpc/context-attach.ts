import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type ContextAttachParams,
  type ContextAttachResult,
} from "@openagent/protocol";

import { buildContextSendPreview } from "../attachments/preview.js";
import { parseContextAttachmentDrafts } from "../attachments/validate.js";
import type { ContextSendPreview } from "../attachments/types.js";

export interface ExecuteContextAttachRpcOptions {
  /** Valor de workspace.context_limit quando persistido; omitido usa default API-03. */
  workspaceContextLimitTokens?: number | null;
}

function toRpcResult(preview: ContextSendPreview): ContextAttachResult {
  return {
    sources: preview.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      path: source.path,
      ...(source.previewText !== undefined ? { previewText: source.previewText } : {}),
      truncated: source.truncated,
      tokenCount: source.tokenCount,
    })),
    messageTokenCount: preview.messageTokenCount,
    totalTokenCount: preview.totalTokenCount,
    contextLimitTokens: preview.contextLimitTokens,
    withinLimit: preview.withinLimit,
  };
}

/**
 * Implementação de context.attach: valida anexos, estima tokens e aplica teto (CTX-01).
 */
export function executeContextAttachRpc(
  params: ContextAttachParams,
  options: ExecuteContextAttachRpcOptions = {},
): ContextAttachResult {
  const parsed = parseContextAttachmentDrafts(params.attachments);
  if (!parsed.valid) {
    throw new ProtocolError(parsed.code, parsed.errors.join(" "));
  }
  if (parsed.value.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Campo 'attachments' deve conter ao menos um anexo.",
    );
  }

  if (
    params.messageText !== undefined &&
    typeof params.messageText !== "string"
  ) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Campo 'messageText' deve ser string quando presente.",
    );
  }

  const preview = buildContextSendPreview({
    attachments: parsed.value,
    messageText: params.messageText,
    workspaceContextLimitTokens: options.workspaceContextLimitTokens,
  });

  return toRpcResult(preview);
}
