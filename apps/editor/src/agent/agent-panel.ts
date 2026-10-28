import {
  ProtocolError,
  USER_INPUT_EMPTY_MESSAGE,
  validateUserInput,
  type UserInput,
} from "@openagent/protocol";

import { summarizeContextAttachments } from "../context/panel-context-slot.js";
import {
  buildAgentPanelView,
  type AgentPanelViewSnapshot,
} from "./agent-panel-view.js";
import {
  createAgentHistoryMessage,
  type AgentHistoryMessage,
} from "./agent-history.js";

export type { AgentHistoryMessage, AgentHistoryRole } from "./agent-history.js";
export { buildAgentPanelView, type AgentPanelViewSnapshot } from "./agent-panel-view.js";

export interface AgentPanelOpenInput {
  sessionId: string;
  initialHistory?: readonly AgentHistoryMessage[];
}

export interface AgentPanelSubmitResult {
  userInput: UserInput;
  history: readonly AgentHistoryMessage[];
  view: AgentPanelViewSnapshot;
}

/**
 * UI-01 (127): painel com composer e histórico; envio validado via protocolo (VAL-01).
 */
export class AgentPanelController {
  private sessionId = "";
  private history: AgentHistoryMessage[] = [];
  private composerText = "";
  private composerDisabled = false;
  private view: AgentPanelViewSnapshot = buildAgentPanelView({
    sessionId: "",
    history: [],
    composerText: "",
    composerDisabled: false,
  });

  get snapshot(): AgentPanelViewSnapshot {
    return this.view;
  }

  open(input: AgentPanelOpenInput): AgentPanelViewSnapshot {
    this.sessionId = input.sessionId;
    this.history = [...(input.initialHistory ?? [])];
    this.composerText = "";
    this.composerDisabled = false;
    this.refreshView();
    return this.view;
  }

  setComposerText(text: string): AgentPanelViewSnapshot {
    this.composerText = text;
    this.refreshView();
    return this.view;
  }

  appendHistory(message: AgentHistoryMessage): AgentPanelViewSnapshot {
    this.history.push(message);
    this.refreshView();
    return this.view;
  }

  submitComposer(): AgentPanelSubmitResult {
    const validation = validateUserInput({ text: this.composerText });
    if (!validation.valid) {
      const message =
        validation.userMessage ??
        `UserInput inválido: ${validation.errors.join("; ")}`;
      throw new ProtocolError(validation.code, message, validation.errors);
    }

    const trimmed = validation.value.text?.trim() ?? "";
    const userMessage = createAgentHistoryMessage("user", trimmed);
    this.history.push(userMessage);
    this.composerText = "";
    this.refreshView();

    return {
      userInput: validation.value,
      history: [...this.history],
      view: this.view,
    };
  }

  private refreshView(): void {
    summarizeContextAttachments([]);
    this.view = buildAgentPanelView({
      sessionId: this.sessionId,
      history: this.history,
      composerText: this.composerText,
      composerDisabled: this.composerDisabled,
    });
  }
}

export { USER_INPUT_EMPTY_MESSAGE };
