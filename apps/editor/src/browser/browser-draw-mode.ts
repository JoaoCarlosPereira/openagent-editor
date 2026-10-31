/**
 * DES-01: modo desenho do painel do navegador — seleção de elemento anexa a
 * identidade (seletor/caminho) e o trecho de código correspondente como rascunho
 * de anexo de contexto (kind "selection", CTX-01) da mensagem seguinte do agente.
 *
 * Contrato de efeitos puros: a conversão seleção→draft é determinística; a
 * entrada inválida não é aqui responsabilidade (o controller valida antes).
 */

import type { ContextAttachmentDraft } from "@openagent/context";

/** Elemento selecionado na captura em modo desenho (DES-01). */
export interface DrawModeElementSelection {
  /** Identidade do elemento: seletor canônico no target autorizado. */
  selector: string;
  /** Trecho de código correspondente ao elemento. */
  codeSnippet: string;
}

/** Contexto do target autorizado onde a seleção aconteceu. */
export interface DrawModeSelectionContext {
  /** URL autorizada do target onde o elemento foi selecionado. */
  url: string;
  /** Número sequencial da seleção (desambigua seleções repetidas). */
  sequence: number;
}

/**
 * DES-01: converte a seleção em rascunho de anexo (CTX-01) para a próxima
 * mensagem do agente — a identidade fica em `path` (`url#seletor`) e o trecho
 * de código em `previewText`.
 */
export function elementSelectionToAttachmentDraft(
  selection: DrawModeElementSelection,
  context: DrawModeSelectionContext,
): ContextAttachmentDraft {
  return {
    id: `des-01:${context.sequence}:${selection.selector}`,
    kind: "selection",
    path: `${context.url}#${selection.selector}`,
    previewText: selection.codeSnippet,
  };
}
