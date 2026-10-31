import type { AgentMode } from "@openagent/protocol";

import type { ContextSendPreviewViewSnapshot } from "../context/context-send-preview-view.js";
import {
  themeTokensCssVariables,
  type AgentPanelTheme,
} from "./agent-panel-appearance.js";
import {
  AGENT_PANEL_FOCUS_TARGETS,
  type AgentPanelFocusTarget,
} from "./agent-panel-keyboard.js";
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
  /** CTX-01 / API-03: prévia de fontes, tokens e teto. */
  contextPreview: ContextSendPreviewViewSnapshot;
  /** UI-01: controle com foco de teclado. */
  focusedControl: AgentPanelFocusTarget;
  /** UI-02: tema claro/escuro. */
  theme: AgentPanelTheme;
  /** UI-02: largura do painel em px. */
  panelWidthPx: number;
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
    focusedControl: AgentPanelFocusTarget;
    composerValidationMessage: string | null;
    contextPreview: ContextSendPreviewViewSnapshot["accessible"];
    theme: AgentPanelTheme;
    panelWidthPx: number;
    historyMessageIds: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function focusAttrs(testId: AgentPanelFocusTarget, focused: AgentPanelFocusTarget): string {
  const isFocused = testId === focused;
  const tab = isFocused ? ' tabindex="0"' : ' tabindex="-1"';
  const focusedAttr = isFocused ? ' data-focused="true"' : "";
  return `${tab}${focusedAttr}`;
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

function renderModeSelect(
  selectedMode: AgentMode,
  focusedControl: AgentPanelFocusTarget,
): string {
  const options = AGENT_PANEL_MODES.map((mode) => {
    const selected = mode === selectedMode ? " selected" : "";
    return `<option value="${mode}"${selected}>${AGENT_PANEL_MODE_LABELS[mode]}</option>`;
  }).join("");
  return [
    `<select id="agent-mode-selector" data-testid="agent-mode-selector"`,
    ` aria-label="Modo do agente"`,
    ` style="background:var(--agent-panel-control-bg);color:var(--agent-panel-control-fg);border-color:var(--agent-panel-border)"`,
    `${focusAttrs("agent-mode-selector", focusedControl)}>`,
    options,
    `</select>`,
  ].join("");
}

function renderModelSelect(
  selectedModelId: string,
  availableModels: readonly AgentPanelModelOption[],
  focusedControl: AgentPanelFocusTarget,
): string {
  const options = availableModels
    .map((model) => {
      const selected = model.id === selectedModelId ? " selected" : "";
      return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.label)}</option>`;
    })
    .join("");
  return [
    `<select id="agent-model-selector" data-testid="agent-model-selector"`,
    ` aria-label="Modelo"`,
    ` style="background:var(--agent-panel-control-bg);color:var(--agent-panel-control-fg);border-color:var(--agent-panel-border)"`,
    `${focusAttrs("agent-model-selector", focusedControl)}>`,
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

/** UI-01 + UI-02 + CTX-01/API-03: painel com tema/largura, seletores, prévia, composer e histórico. */
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
  const focusOrder = AGENT_PANEL_FOCUS_TARGETS;
  const focused = input.focusedControl;
  const theme = input.theme;
  const panelWidthPx = input.panelWidthPx;
  const styleVars = [
    `width:${panelWidthPx}px`,
    `max-width:${panelWidthPx}px`,
    themeTokensCssVariables(theme),
    `background:var(--agent-panel-bg)`,
    `color:var(--agent-panel-fg)`,
    `border-color:var(--agent-panel-border)`,
  ].join(";");

  const html = [
    `<section role="region" aria-labelledby="agent-panel-title" data-testid="agent-panel"`,
    ` data-theme="${theme}" data-panel-width="${panelWidthPx}"`,
    ` data-focused-control="${focused}" style="${styleVars}">`,
    `<h2 id="agent-panel-title">Painel do agente</h2>`,
    renderModeSelect(input.mode, focused),
    renderModelSelect(input.modelId, input.availableModels, focused),
    `<div data-testid="agent-context-slot" role="group" aria-label="Contexto anexado"`,
    `${focusAttrs("agent-context-slot", focused)}>`,
    input.contextPreview.html,
    `</div>`,
    `<ol data-testid="agent-history" aria-live="polite"`,
    `${focusAttrs("agent-history", focused)}>${historyItems}</ol>`,
    `<form data-testid="agent-composer">`,
    `<label for="agent-composer-input">Mensagem</label>`,
    `<textarea id="agent-composer-input" data-testid="agent-composer-input" name="composer"`,
    ` aria-label="Composer do agente"${focusAttrs("agent-composer-input", focused)}`,
    `${composerDisabledAttr}${invalidAttr}>`,
    `${escapeHtml(input.composerText)}</textarea>`,
    renderComposerValidation(validationMessage),
    `<button type="button" data-testid="agent-composer-send"`,
    `${focusAttrs("agent-composer-send", focused)}${composerDisabledAttr}>Enviar</button>`,
    `</form>`,
    `<div data-testid="agent-review-slot" role="group" aria-label="Revisão de alterações"`,
    `${focusAttrs("agent-review-slot", focused)}></div>`,
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
      focusedControl: focused,
      composerValidationMessage:
        validationMessage !== undefined && validationMessage.length > 0
          ? validationMessage
          : null,
      contextPreview: input.contextPreview.accessible,
      theme,
      panelWidthPx,
      historyMessageIds: input.history.map((message) => message.id),
    },
  };
}
