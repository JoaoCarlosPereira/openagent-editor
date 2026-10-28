import type { ContextAttachmentDraft } from "@openagent/context";
import type { UserContextAttachment } from "@openagent/protocol";

/** Anexo do painel = rascunho CTX-01 (id vira ref do UserInput). */
export type AgentPanelContextAttachment = ContextAttachmentDraft;

export function summarizeContextAttachments(
  attachments: readonly AgentPanelContextAttachment[],
): { count: number; labels: string[] } {
  return {
    count: attachments.length,
    labels: attachments.map((item) =>
      item.kind === "symbol" && item.symbolName
        ? `${item.symbolName} (${item.path})`
        : item.path,
    ),
  };
}

/** Mapeia anexos do painel para o contrato UserInput (VAL-01). */
export function toUserInputAttachments(
  attachments: readonly AgentPanelContextAttachment[],
): UserContextAttachment[] {
  return attachments.map((item) => ({ ref: item.id }));
}
