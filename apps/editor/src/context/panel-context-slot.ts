/** Região de contexto do painel (CTX-01); preenchida em tarefas posteriores. */
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
