import type { TextEditorDocument } from "./text-editor.js";

export interface TextEditorViewInput {
  document: TextEditorDocument | null;
}

export interface TextEditorViewSnapshot {
  html: string;
  accessible: {
    relativePath: string | null;
    dirty: boolean;
    contentLength: number;
    open: boolean;
    focusOrder: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** LOC-01 (121): painel observável do editor de texto (abrir / editar / salvar). */
export function buildTextEditorView(input: TextEditorViewInput): TextEditorViewSnapshot {
  const doc = input.document;
  const open = doc !== null;
  const focusOrder = open
    ? (["workbench-slot-editor", "text-editor-path", "text-editor-content", "text-editor-save"] as const)
    : (["workbench-slot-editor"] as const);

  const body = open
    ? [
        `<p data-testid="text-editor-path" tabindex="0">${escapeHtml(doc.relativePath)}</p>`,
        `<textarea data-testid="text-editor-content" aria-label="Conteúdo do arquivo"`,
        ` data-dirty="${doc.dirty ? "true" : "false"}" tabindex="0">`,
        `${escapeHtml(doc.content)}</textarea>`,
        `<button type="button" data-testid="text-editor-save" tabindex="0"`,
        ` ${doc.dirty ? "" : "disabled "}>Salvar</button>`,
        `<span data-testid="text-editor-dirty" aria-live="polite">`,
        `${doc.dirty ? "Alterações não salvas" : "Salvo"}</span>`,
      ].join("")
    : `<p data-testid="text-editor-empty" aria-live="polite">Abra um arquivo para editar</p>`;

  const html = [
    `<section role="region" aria-label="editor"`,
    ` data-testid="workbench-slot-editor" data-capability="editor"`,
    ` data-editor-panel="workbench-text-editor"`,
    ` data-document-open="${open ? "true" : "false"}"`,
    ` data-dirty="${open && doc.dirty ? "true" : "false"}"`,
    ` data-path="${open ? escapeHtml(doc.relativePath) : ""}" tabindex="0">`,
    `<h3 data-testid="text-editor-heading">editor</h3>`,
    body,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      relativePath: open ? doc.relativePath : null,
      dirty: open ? doc.dirty : false,
      contentLength: open ? doc.content.length : 0,
      open,
      focusOrder,
    },
  };
}
