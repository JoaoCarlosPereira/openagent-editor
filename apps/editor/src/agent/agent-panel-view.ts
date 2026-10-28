import type { AgentMode } from "@openagent/protocol";

import { formatAgentHistoryRoleLabel, type AgentHistoryMessage } from "./agent-history.js";
import {
  AGENT_PANEL_MODE_LABELS,
  AGENT_PANEL_MODES,
  type AgentPanelModelOption,
} from "./agent-panel-selectors.js";

export interface AgentPanelViewInput {
  sessionId: string;
  history: readonly AgentHistoryMessage[];
  composerText: string;
  composerDisabled: boolean;
  mode: AgentMode;
  modelId: string;
  availableModels: readonly AgentPanelModelOption[];
  /** VAL-01: mensagem de recusa do composer (texto exato do PRD quando vazio). */
  composerValidationMessage?: string;
}

export interface AgentPanelViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    historyCount: number;
    composerText: string;
    mode: AgentMode;
    modelId: string;
    focusOrder: readonly string[];
    composerValidationMessage: string | null;
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

function renderModeSelect(selectedMode: AgentMode): string {
  const options = AGENT_PANEL_MODES.map((mode) => {
    const selected = mode === selectedMode ? " selected" : "";
    return `<option value="${mode}"${selected}>${AGENT_PANEL_MODE_LABELS[mode]}</option>`;
  }).join("");
  return [
    `<select id="agent-mode-selector" data-testid="agent-mode-selector"`,
    ` aria-label="Modo do agente" tabindex="0">`,
    options,
    `</select>`,
  ].join("");
}

function renderModelSelect(
  selectedModelId: string,
  availableModels: readonly AgentPanelModelOption[],
): string {
  const options = availableModels
    .map((model) => {
      const selected = model.id === selectedModelId ? " selected" : "";
      return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.label)}</option>`;
    })
    .join("");
  return [
    `<select id="agent-model-selector" data-testid="agent-model-selector"`,
    ` aria-label="Modelo" tabindex="0">`,
    options,
    `</select>`,
  ].join("");
}

function renderComposerValidation(message: string | undefined): string {
  if (message === undefined || message.length === 0) {
    return "";
  }
  return [
    `<p role="alert" aria-live="assertive" data-testid="agent-composer-validation">`,
    escapeHtml(message),
    `</p>`,
  ].join("");
}

/** UI-01 (127–129): painel do agente com seletores, composer, VAL-01 e histórico acessível. */
export function buildAgentPanelView(input: AgentPanelViewInput): AgentPanelViewSnapshot {
  const historyItems =
    input.history.length > 0
      ? input.history.map(renderHistoryMessage).join("")
      : `<li data-testid="agent-history-empty">Nenhuma mensagem ainda.</li>`;

  const composerDisabledAttr = input.composerDisabled ? " disabled" : "";
  const validationMessage = input.composerValidationMessage;
  const hasValidation =
    validationMessage !== undefined && validationMessage.length > 0;
  const invalidAttr = hasValidation ? ` aria-invalid="true"` : "";
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
    renderModeSelect(input.mode),
    renderModelSelect(input.modelId, input.availableModels),
    `<div data-testid="agent-context-slot" role="group" aria-label="Contexto anexado" tabindex="0"></div>`,
    `<ol data-testid="agent-history" aria-live="polite" tabindex="0">${historyItems}</ol>`,
    `<form data-testid="agent-composer">`,
    `<label for="agent-composer-input">Mensagem</label>`,
    `<textarea id="agent-composer-input" data-testid="agent-composer-input" name="composer"`,
    ` aria-label="Composer do agente" tabindex="0"${composerDisabledAttr}${invalidAttr}>`,
    `${escapeHtml(input.composerText)}</textarea>`,
    renderComposerValidation(validationMessage),
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
      mode: input.mode,
      modelId: input.modelId,
      focusOrder,
      composerValidationMessage:
        validationMessage !== undefined && validationMessage.length > 0
          ? validationMessage
          : null,
    },
  };
}
