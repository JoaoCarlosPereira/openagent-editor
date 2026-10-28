import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import { buildExternalContextUserContent } from "../attachments/external-payload.js";
import { buildContextSendPreview } from "../attachments/preview.js";
import type {
  ContextExternalSendParams,
  ContextExternalSendResult,
} from "../attachments/types.js";
import { parseContextAttachmentDrafts } from "../attachments/validate.js";
import {
  filterIncludedContextAttachmentDrafts,
  resolveContextExclusionRuleset,
} from "../exclusions/rules.js";

export interface ExecuteContextSendRpcOptions {
  workspaceContextLimitTokens?: number | null;
  workspaceRoot?: string;
  workspaceExclusionPatterns?: unknown;
}

/**
 * PRV-01: monta payload para API externa somente após confirmação explícita;
 * omite anexos em caminhos excluídos.
 */
export function executeContextSendRpc(
  params: ContextExternalSendParams,
  options: ExecuteContextSendRpcOptions = {},
): ContextExternalSendResult {
  if (params.explicitSendAcknowledged !== true) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Envio externo exige confirmação explícita (explicitSendAcknowledged=true).",
    );
  }

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

  let attachments = parsed.value;
  if (options.workspaceRoot !== undefined && options.workspaceRoot.trim().length > 0) {
    const ruleset = resolveContextExclusionRuleset({
      workspaceRoot: options.workspaceRoot,
      workspaceExclusionPatterns: options.workspaceExclusionPatterns ?? [],
    });
    attachments = filterIncludedContextAttachmentDrafts(ruleset, attachments);
    if (attachments.length === 0) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Nenhum anexo permanece após aplicar regras de exclusão do workspace.",
      );
    }
  }

  const preview = buildContextSendPreview({
    attachments,
    messageText: params.messageText,
    workspaceContextLimitTokens: options.workspaceContextLimitTokens,
  });

  const content = buildExternalContextUserContent({
    messageText: params.messageText,
    sources: preview.sources,
  });

  return {
    content,
    includedPaths: preview.sources.map((source) => source.path),
    messageTokenCount: preview.messageTokenCount,
    totalTokenCount: preview.totalTokenCount,
    contextLimitTokens: preview.contextLimitTokens,
    withinLimit: preview.withinLimit,
  };
}
