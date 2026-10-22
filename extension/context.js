'use strict';

function editorContext(editor, limit) {
  if (!editor) return null;
  const document = editor.document;
  const selected = !editor.selection.isEmpty;
  const source = selected ? document.getText(editor.selection) : document.getText();
  return {
    uri: document.uri.toString(),
    path: document.uri.fsPath,
    language: document.languageId,
    selected,
    selection: selected ? editor.selection : null,
    version: document.version,
    text: source.slice(0, limit),
    truncated: source.length > limit
  };
}

function contextMessage(context) {
  if (!context) return '';
  const suffix = context.truncated ? '\n[contexto truncado]' : '';
  return `\n\nContexto enviado pelo usuário: ${context.path}\nLinguagem: ${context.language}\nEscopo: ${context.selected ? 'seleção' : 'arquivo'}\n\`\`\`\n${context.text}\n\`\`\`${suffix}`;
}

module.exports = { editorContext, contextMessage };
