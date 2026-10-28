import {
  ProtocolError,
  USER_INPUT_EMPTY_MESSAGE,
  validateUserInput,
  type AgentMode,
  type UserInput,
} from "@openagent/protocol";

import {
  summarizeContextAttachments,
  toUserInputAttachments,
  type AgentPanelContextAttachment,
} from "../context/panel-context-slot.js";
import {
  buildAgentPanelView,
  type AgentPanelViewSnapshot,
} from "./agent-panel-view.js";
import {
  createAgentHistoryMessage,
  type AgentHistoryMessage,
} from "./agent-history.js";
import {
  DEFAULT_AGENT_PANEL_MODELS,
  assertAgentPanelMode,
  assertAgentPanelModelId,
  type AgentPanelModelOption,
} from "./agent-panel-selectors.js";

export type { AgentHistoryMessage, AgentHistoryRole } from "./agent-history.js";
export { buildAgentPanelView, type AgentPanelViewSnapshot } from "./agent-panel-view.js";
export {
  AGENT_PANEL_MODES,
  DEFAULT_AGENT_PANEL_MODELS,
  type AgentPanelModelOption,
} from "./agent-panel-selectors.js";
export type { AgentPanelContextAttachment } from "../context/panel-context-slot.js";

export interface AgentPanelOpenInput {
  sessionId: string;
  initialHistory?: readonly AgentHistoryMessage[];
  mode?: AgentMode;
  modelId?: string;
  availableModels?: readonly AgentPanelModelOption[];
  initialAttachments?: readonly AgentPanelContextAttachment[];
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

/**
 * UI-01 / VAL-01: painel com seletores, composer, histórico e recusa de envio vazio com texto exato.
 */
export class AgentPanelController {
  private sessionId = "";
  private history: AgentHistoryMessage[] = [];
  private composerText = "";
  private composerDisabled = false;
  private composerValidationMessage: string | undefined;
  private contextAttachments: AgentPanelContextAttachment[] = [];
  private mode: AgentMode = "agent";
  private modelId = firstAvailableModelId(DEFAULT_AGENT_PANEL_MODELS);
  private availableModels: readonly AgentPanelModelOption[] = DEFAULT_AGENT_PANEL_MODELS;
  private view: AgentPanelViewSnapshot = buildAgentPanelView({
    sessionId: "",
    history: [],
    composerText: "",
    composerDisabled: false,
    mode: "agent",
    modelId: firstAvailableModelId(DEFAULT_AGENT_PANEL_MODELS),
    availableModels: DEFAULT_AGENT_PANEL_MODELS,
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
    this.contextAttachments = [...(input.initialAttachments ?? [])];
    this.availableModels =
      input.availableModels && input.availableModels.length > 0
        ? [...input.availableModels]
        : [...DEFAULT_AGENT_PANEL_MODELS];
    this.mode = input.mode !== undefined ? assertAgentPanelMode(input.mode) : "agent";
    this.modelId =
      input.modelId !== undefined
        ? assertAgentPanelModelId(input.modelId, this.availableModels)
        : firstAvailableModelId(this.availableModels);
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

  setComposerText(text: string): AgentPanelViewSnapshot {
    this.composerText = text;
    this.composerValidationMessage = undefined;
    this.refreshView();
    return this.view;
  }

  setContextAttachments(
    attachments: readonly AgentPanelContextAttachment[],
  ): AgentPanelViewSnapshot {
    this.contextAttachments = [...attachments];
    this.composerValidationMessage = undefined;
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

  private refreshView(): void {
    summarizeContextAttachments(this.contextAttachments);
    this.view = buildAgentPanelView({
      sessionId: this.sessionId,
      history: this.history,
      composerText: this.composerText,
      composerDisabled: this.composerDisabled,
      mode: this.mode,
      modelId: this.modelId,
      availableModels: this.availableModels,
      ...(this.composerValidationMessage !== undefined
        ? { composerValidationMessage: this.composerValidationMessage }
        : {}),
    });
  }
}

export { USER_INPUT_EMPTY_MESSAGE };
