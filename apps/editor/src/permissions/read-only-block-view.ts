/** PER-03: aviso visível quando Somente leitura bloqueia mutação. */
export interface ReadOnlyBlockViewInput {
  action: string;
  target: string;
  message: string;
}

export interface ReadOnlyBlockViewSnapshot {
  html: string;
  accessible: {
    action: string;
    target: string;
    message: string;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReadOnlyBlockView(input: ReadOnlyBlockViewInput): ReadOnlyBlockViewSnapshot {
  const html = [
    `<aside role="alert" aria-live="assertive" data-testid="read-only-block">`,
    `<p data-testid="read-only-block-message">${escapeHtml(input.message)}</p>`,
    `<p data-testid="read-only-block-action">${escapeHtml(input.action)}</p>`,
    `<p data-testid="read-only-block-target">${escapeHtml(input.target)}</p>`,
    `</aside>`,
  ].join("");

  return {
    html,
    accessible: {
      action: input.action,
      target: input.target,
      message: input.message,
    },
  };
}
