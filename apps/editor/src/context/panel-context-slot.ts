import type { UserContextAttachment } from "@openagent/protocol";

/** Região de contexto do painel (CTX-01 / VAL-01 anexos); preenchida incrementalmente. */
export interface AgentPanelContextAttachment {
  ref: string;
  label: string;
}

export function summarizeContextAttachments(
  attachments: readonly AgentPanelContextAttachment[],
): { count: number; labels: string[] } {
  return {
    count: attachments.length,
    labels: attachments.map((item) => item.label),
  };
}

/** Mapeia anexos do painel para o contrato UserInput (VAL-01). */
export function toUserInputAttachments(
  attachments: readonly AgentPanelContextAttachment[],
): UserContextAttachment[] {
  return attachments.map((item) => ({ ref: item.ref }));
}
