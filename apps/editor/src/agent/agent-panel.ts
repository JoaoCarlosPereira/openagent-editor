import {
  buildContextSendPreview,
  parseContextAttachmentDrafts,
} from "@openagent/context";
import {
  ProtocolError,
  USER_INPUT_EMPTY_MESSAGE,
  validateUserInput,
  type AgentMode,
  type UserInput,
} from "@openagent/protocol";

import { buildContextSendPreviewView } from "../context/context-send-preview-view.js";
import {
  summarizeContextAttachments,
  toUserInputAttachments,
  type AgentPanelContextAttachment,
} from "../context/panel-context-slot.js";
import {
  AGENT_PANEL_THEME_DEFAULT,
  AGENT_PANEL_WIDTH_DEFAULT_PX,
  assertAgentPanelTheme,
  assertAgentPanelWidthPx,
  type AgentPanelTheme,
} from "./agent-panel-appearance.js";
import {
  buildAgentPanelView,
  type AgentPanelViewSnapshot,
} from "./agent-panel-view.js";
import {
  createAgentHistoryMessage,
  type AgentHistoryMessage,
} from "./agent-history.js";
import {
  AGENT_PANEL_FOCUS_TARGETS,
  assertAgentPanelFocusTarget,
  resolveAgentPanelFocusNeighbor,
  resolveAgentPanelKeyboardDirection,
  type AgentPanelFocusTarget,
  type AgentPanelKeyboardEvent,
} from "./agent-panel-keyboard.js";
import {
  DEFAULT_AGENT_PANEL_MODELS,
  assertAgentPanelMode,
  assertAgentPanelModelId,
  type AgentPanelModelOption,
} from "./agent-panel-selectors.js";

export type { AgentHistoryMessage, AgentHistoryRole } from "./agent-history.js";
export { buildAgentPanelView, type AgentPanelViewSnapshot } from "./agent-panel-view.js";
export {
  AGENT_PANEL_FOCUS_TARGETS,
  assertAgentPanelFocusTarget,
  type AgentPanelFocusTarget,
  type AgentPanelKeyboardEvent,
} from "./agent-panel-keyboard.js";
export {
  AGENT_PANEL_MODES,
  DEFAULT_AGENT_PANEL_MODELS,
  type AgentPanelModelOption,
} from "./agent-panel-selectors.js";
export {
  AGENT_PANEL_THEMES,
  AGENT_PANEL_THEME_DEFAULT,
  AGENT_PANEL_THEME_TOKENS,
  AGENT_PANEL_WIDTH_DEFAULT_PX,
  AGENT_PANEL_WIDTH_MAX_PX,
  AGENT_PANEL_WIDTH_MIN_PX,
  assertAgentPanelTheme,
  assertAgentPanelWidthPx,
  type AgentPanelTheme,
  type AgentPanelThemeTokens,
} from "./agent-panel-appearance.js";
export type { AgentPanelContextAttachment } from "../context/panel-context-slot.js";
export { buildContextSendPreviewView } from "../context/context-send-preview-view.js";

export interface AgentPanelOpenInput {
  sessionId: string;
  initialHistory?: readonly AgentHistoryMessage[];
  mode?: AgentMode;
  modelId?: string;
  availableModels?: readonly AgentPanelModelOption[];
  initialAttachments?: readonly AgentPanelContextAttachment[];
  /** null/undefined = API-03 default 200000. */
  workspaceContextLimitTokens?: number | null;
  /** UI-02: tema inicial (padrão light). */
  theme?: AgentPanelTheme;
  /** UI-02: largura inicial em px. */
  panelWidthPx?: number;
}

export interface AgentPanelSubmitResult {
  userInput: UserInput;
  history: readonly AgentHistoryMessage[];
  mode: AgentMode;
  modelId: string;
  view: AgentPanelViewSnapshot;
}

function firstAvailableModelId(
  models: readonly AgentPanelModelOption[],
): string {
  const first = models.at(0);
  if (first === undefined) {
    return "default";
  }
  return first.id;
}

function emptyContextPreview(workspaceContextLimitTokens: number | null) {
  return buildContextSendPreviewView(
    buildContextSendPreview({
      attachments: [],
      messageText: "",
      workspaceContextLimitTokens,
    }),
  );
}

/**
 * UI-01 / UI-02 / VAL-01 / CTX-01 / API-03: painel com seletores, tema/largura,
 * prévia de contexto, composer, histórico, teclado e recusa de envio vazio.
 */
export class AgentPanelController {
  private sessionId = "";
  private history: AgentHistoryMessage[] = [];
  private composerText = "";
  private composerDisabled = false;
  private composerValidationMessage: string | undefined;
  private contextAttachments: AgentPanelContextAttachment[] = [];
  private workspaceContextLimitTokens: number | null = null;
  private mode: AgentMode = "agent";
  private modelId = firstAvailableModelId(DEFAULT_AGENT_PANEL_MODELS);
  private availableModels: readonly AgentPanelModelOption[] = DEFAULT_AGENT_PANEL_MODELS;
  private focusedControl: AgentPanelFocusTarget = AGENT_PANEL_FOCUS_TARGETS[0];
  private theme: AgentPanelTheme = AGENT_PANEL_THEME_DEFAULT;
  private panelWidthPx = AGENT_PANEL_WIDTH_DEFAULT_PX;
  private view: AgentPanelViewSnapshot = buildAgentPanelView({
    sessionId: "",
    history: [],
    composerText: "",
    composerDisabled: false,
    mode: "agent",
    modelId: firstAvailableModelId(DEFAULT_AGENT_PANEL_MODELS),
    availableModels: DEFAULT_AGENT_PANEL_MODELS,
    contextPreview: emptyContextPreview(null),
    focusedControl: AGENT_PANEL_FOCUS_TARGETS[0],
    theme: AGENT_PANEL_THEME_DEFAULT,
    panelWidthPx: AGENT_PANEL_WIDTH_DEFAULT_PX,
  });

  get snapshot(): AgentPanelViewSnapshot {
    return this.view;
  }

  open(input: AgentPanelOpenInput): AgentPanelViewSnapshot {
    this.sessionId = input.sessionId;
    this.history = [...(input.initialHistory ?? [])];
    this.composerText = "";
    this.composerDisabled = false;
    this.composerValidationMessage = undefined;
    this.focusedControl = AGENT_PANEL_FOCUS_TARGETS[0];
    this.workspaceContextLimitTokens =
      input.workspaceContextLimitTokens === undefined
        ? null
        : input.workspaceContextLimitTokens;
    if (input.initialAttachments !== undefined) {
      this.replaceAttachmentsOrThrow(input.initialAttachments);
    } else {
      this.contextAttachments = [];
    }
    this.availableModels =
      input.availableModels && input.availableModels.length > 0
        ? [...input.availableModels]
        : [...DEFAULT_AGENT_PANEL_MODELS];
    this.mode = input.mode !== undefined ? assertAgentPanelMode(input.mode) : "agent";
    this.modelId =
      input.modelId !== undefined
        ? assertAgentPanelModelId(input.modelId, this.availableModels)
        : firstAvailableModelId(this.availableModels);
    this.theme =
      input.theme !== undefined
        ? assertAgentPanelTheme(input.theme)
        : AGENT_PANEL_THEME_DEFAULT;
    this.panelWidthPx =
      input.panelWidthPx !== undefined
        ? assertAgentPanelWidthPx(input.panelWidthPx)
        : AGENT_PANEL_WIDTH_DEFAULT_PX;
    this.refreshView();
    return this.view;
  }

  /** UI-01: move o foco de teclado para um controle nomeado do painel. */
  setFocusedControl(control: unknown): AgentPanelViewSnapshot {
    this.focusedControl = assertAgentPanelFocusTarget(control);
    this.refreshView();
    return this.view;
  }

  /** UI-01: avança o foco na ordem declarada (Tab / seta). */
  focusNext(): AgentPanelViewSnapshot {
    this.focusedControl = resolveAgentPanelFocusNeighbor(this.focusedControl, "next");
    this.refreshView();
    return this.view;
  }

  /** UI-01: recua o foco na ordem declarada (Shift+Tab / seta). */
  focusPrevious(): AgentPanelViewSnapshot {
    this.focusedControl = resolveAgentPanelFocusNeighbor(
      this.focusedControl,
      "previous",
    );
    this.refreshView();
    return this.view;
  }

  /**
   * UI-01: interpreta Tab/Shift+Tab/setas. Tecla inválida → INVALID_STATE
   * sem alterar o foco atual.
   */
  handleKeyboard(event: AgentPanelKeyboardEvent): AgentPanelViewSnapshot {
    const direction = resolveAgentPanelKeyboardDirection(event);
    this.focusedControl = resolveAgentPanelFocusNeighbor(
      this.focusedControl,
      direction,
    );
    this.refreshView();
    return this.view;
  }

  setMode(mode: unknown): AgentPanelViewSnapshot {
    this.mode = assertAgentPanelMode(mode);
    this.refreshView();
    return this.view;
  }

  setModel(modelId: unknown): AgentPanelViewSnapshot {
    this.modelId = assertAgentPanelModelId(modelId, this.availableModels);
    this.refreshView();
    return this.view;
  }

  /**
   * UI-02: alterna tema claro/escuro sem alterar o histórico da conversa.
   * Tema inválido → INVALID_STATE sem efeito colateral.
   */
  setTheme(theme: unknown): AgentPanelViewSnapshot {
    this.theme = assertAgentPanelTheme(theme);
    this.refreshView();
    return this.view;
  }

  /**
   * UI-02: altera a largura do painel sem alterar o histórico da conversa.
   * Largura inválida → INVALID_STATE sem efeito colateral.
   */
  setPanelWidth(panelWidthPx: unknown): AgentPanelViewSnapshot {
    this.panelWidthPx = assertAgentPanelWidthPx(panelWidthPx);
    this.refreshView();
    return this.view;
  }

  setComposerText(text: string): AgentPanelViewSnapshot {
    this.composerText = text;
    this.composerValidationMessage = undefined;
    this.refreshView();
    return this.view;
  }

  /**
   * CTX-01: anexa fontes. Entrada inválida → INVALID_STATE sem alterar anexos.
   */
  setContextAttachments(attachments: unknown): AgentPanelViewSnapshot {
    this.replaceAttachmentsOrThrow(attachments);
    this.composerValidationMessage = undefined;
    this.refreshView();
    return this.view;
  }

  setWorkspaceContextLimitTokens(
    limit: number | null,
  ): AgentPanelViewSnapshot {
    this.workspaceContextLimitTokens = limit;
    this.refreshView();
    return this.view;
  }

  appendHistory(message: AgentHistoryMessage): AgentPanelViewSnapshot {
    this.history.push(message);
    this.refreshView();
    return this.view;
  }

  submitComposer(): AgentPanelSubmitResult {
    const validation = validateUserInput({
      text: this.composerText,
      attachments: toUserInputAttachments(this.contextAttachments),
    });
    if (!validation.valid) {
      const message =
        validation.userMessage ??
        `UserInput inválido: ${validation.errors.join("; ")}`;
      // VAL-01: exibir o texto exato na UI antes de recusar com INVALID_STATE.
      this.composerValidationMessage = validation.userMessage ?? message;
      this.refreshView();
      throw new ProtocolError(validation.code, message, validation.errors);
    }

    const trimmed = validation.value.text?.trim() ?? "";
    const historyContent =
      trimmed.length > 0
        ? trimmed
        : summarizeContextAttachments(this.contextAttachments).labels.join(", ");
    const userMessage = createAgentHistoryMessage("user", historyContent);
    this.history.push(userMessage);
    this.composerText = "";
    this.composerValidationMessage = undefined;
    this.refreshView();

    return {
      userInput: validation.value,
      history: [...this.history],
      mode: this.mode,
      modelId: this.modelId,
      view: this.view,
    };
  }

  private replaceAttachmentsOrThrow(attachments: unknown): void {
    const parsed = parseContextAttachmentDrafts(attachments);
    if (!parsed.valid) {
      throw new ProtocolError(parsed.code, parsed.errors.join(" "), parsed.errors);
    }
    this.contextAttachments = parsed.value;
  }

  private refreshView(): void {
    const preview = buildContextSendPreviewView(
      buildContextSendPreview({
        attachments: this.contextAttachments,
        messageText: this.composerText,
        workspaceContextLimitTokens: this.workspaceContextLimitTokens,
      }),
    );
    this.view = buildAgentPanelView({
      sessionId: this.sessionId,
      history: this.history,
      composerText: this.composerText,
      composerDisabled: this.composerDisabled,
      mode: this.mode,
      modelId: this.modelId,
      availableModels: this.availableModels,
      contextPreview: preview,
      focusedControl: this.focusedControl,
      theme: this.theme,
      panelWidthPx: this.panelWidthPx,
      ...(this.composerValidationMessage !== undefined
        ? { composerValidationMessage: this.composerValidationMessage }
        : {}),
    });
  }
}

export { USER_INPUT_EMPTY_MESSAGE };
