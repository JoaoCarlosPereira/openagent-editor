import type { ContextAttachmentSource } from "./types.js";

function formatAttachmentBlock(source: ContextAttachmentSource): string {
  const scopeLabel =
    source.kind === "selection"
      ? "seleção"
      : source.kind === "folder"
        ? "pasta"
        : source.kind === "symbol"
          ? "símbolo"
          : "arquivo";
  const truncatedSuffix = source.truncated ? "\n[contexto truncado]" : "";
  const body =
    source.previewText !== undefined && source.previewText.length > 0
      ? `\n\`\`\`\n${source.previewText}\n\`\`\``
      : "";
  return `\n\nContexto: ${source.label}\nCaminho: ${source.path}\nEscopo: ${scopeLabel}${body}${truncatedSuffix}`;
}

/**
 * Monta o conteúdo enviado ao provedor externo a partir de fontes já filtradas (PRV-01).
 */
export function buildExternalContextUserContent(input: {
  messageText?: string;
  sources: ContextAttachmentSource[];
}): string {
  const message = input.messageText?.trim() ?? "";
  const blocks = input.sources.map(formatAttachmentBlock).join("");
  if (message.length === 0) {
    return blocks.trimStart();
  }
  if (blocks.length === 0) {
    return message;
  }
  return `${message}${blocks}`;
}
