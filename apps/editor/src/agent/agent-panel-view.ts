import { formatAgentHistoryRoleLabel, type AgentHistoryMessage } from "./agent-history.js";

export interface AgentPanelViewInput {
  sessionId: string;
  history: readonly AgentHistoryMessage[];
  composerText: string;
  composerDisabled: boolean;
}

export interface AgentPanelViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    historyCount: number;
    composerText: string;
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

function renderHistoryMessage(message: AgentHistoryMessage): string {
  const roleLabel = formatAgentHistoryRoleLabel(message.role);
  return [
    `<li data-testid="agent-history-item" data-role="${message.role}" data-message-id="${escapeHtml(message.id)}">`,
    `<span data-testid="agent-history-role">${escapeHtml(roleLabel)}</span>`,
    `<p data-testid="agent-history-body">${escapeHtml(message.content)}</p>`,
    `</li>`,
  ].join("");
}

/** UI-01 (127): painel do agente com composer e histórico acessível por teclado. */
export function buildAgentPanelView(input: AgentPanelViewInput): AgentPanelViewSnapshot {
  const historyItems =
    input.history.length > 0
      ? input.history.map(renderHistoryMessage).join("")
      : `<li data-testid="agent-history-empty">Nenhuma mensagem ainda.</li>`;

  const composerDisabledAttr = input.composerDisabled ? " disabled" : "";
  const focusOrder = [
    "agent-mode-selector",
    "agent-model-selector",
    "agent-context-slot",
    "agent-history",
    "agent-composer-input",
    "agent-composer-send",
    "agent-review-slot",
  ] as const;

  const html = [
    `<section role="region" aria-labelledby="agent-panel-title" data-testid="agent-panel">`,
    `<h2 id="agent-panel-title">Painel do agente</h2>`,
    `<select id="agent-mode-selector" data-testid="agent-mode-selector" aria-label="Modo do agente" tabindex="0" disabled>`,
    `<option value="agent">Agent</option>`,
    `</select>`,
    `<select id="agent-model-selector" data-testid="agent-model-selector" aria-label="Modelo" tabindex="0" disabled>`,
    `<option value="default">Padrão</option>`,
    `</select>`,
    `<div data-testid="agent-context-slot" role="group" aria-label="Contexto anexado" tabindex="0"></div>`,
    `<ol data-testid="agent-history" aria-live="polite" tabindex="0">${historyItems}</ol>`,
    `<form data-testid="agent-composer">`,
    `<label for="agent-composer-input">Mensagem</label>`,
    `<textarea id="agent-composer-input" data-testid="agent-composer-input" name="composer"`,
    ` aria-label="Composer do agente" tabindex="0"${composerDisabledAttr}>`,
    `${escapeHtml(input.composerText)}</textarea>`,
    `<button type="button" data-testid="agent-composer-send" tabindex="0"${composerDisabledAttr}>Enviar</button>`,
    `</form>`,
    `<div data-testid="agent-review-slot" role="group" aria-label="Revisão de alterações" tabindex="0"></div>`,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      sessionId: input.sessionId,
      historyCount: input.history.length,
      composerText: input.composerText,
      focusOrder,
    },
  };
}
