import type { ContextAttachmentSource, ContextSendPreview } from "@openagent/context";

export interface ContextSendPreviewViewSnapshot {
  html: string;
  accessible: {
    sourceCount: number;
    sourceLabels: readonly string[];
    messageTokenCount: number;
    totalTokenCount: number;
    contextLimitTokens: number;
    withinLimit: boolean;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSource(source: ContextAttachmentSource): string {
  return [
    `<li data-testid="context-source" data-kind="${escapeHtml(source.kind)}"`,
    ` data-source-id="${escapeHtml(source.id)}">`,
    `<span data-testid="context-source-label">${escapeHtml(source.label)}</span>`,
    `<span data-testid="context-source-tokens">${source.tokenCount}</span>`,
    `</li>`,
  ].join("");
}

/**
 * CTX-01 / API-03: prévia de fontes, tokens e teto antes do envio.
 * Sempre exibe o teto (default 200000 quando o workspace não gravou outro).
 */
export function buildContextSendPreviewView(
  preview: ContextSendPreview,
): ContextSendPreviewViewSnapshot {
  const sourceItems =
    preview.sources.length > 0
      ? preview.sources.map(renderSource).join("")
      : `<li data-testid="context-source-empty">Nenhuma fonte anexada.</li>`;

  const html = [
    `<div data-testid="context-send-preview" role="group" aria-label="Prévia de contexto">`,
    `<ul data-testid="context-source-list">${sourceItems}</ul>`,
    `<p data-testid="context-message-tokens">Mensagem: ${preview.messageTokenCount} tokens</p>`,
    `<p data-testid="context-token-total">Total: ${preview.totalTokenCount} tokens</p>`,
    `<p data-testid="context-token-limit">Teto: ${preview.contextLimitTokens} tokens</p>`,
    `<p data-testid="context-within-limit" data-within="${preview.withinLimit ? "true" : "false"}">`,
    preview.withinLimit ? "Dentro do teto" : "Acima do teto",
    `</p>`,
    `</div>`,
  ].join("");

  return {
    html,
    accessible: {
      sourceCount: preview.sources.length,
      sourceLabels: preview.sources.map((row) => row.label),
      messageTokenCount: preview.messageTokenCount,
      totalTokenCount: preview.totalTokenCount,
      contextLimitTokens: preview.contextLimitTokens,
      withinLimit: preview.withinLimit,
    },
  };
}
