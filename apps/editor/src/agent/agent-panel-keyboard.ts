import { ProtocolError } from "@openagent/protocol";

/** Ordem de foco UI-01: modo, modelo, contexto, histórico, composer, enviar, revisão. */
export const AGENT_PANEL_FOCUS_TARGETS = [
  "agent-mode-selector",
  "agent-model-selector",
  "agent-context-slot",
  "agent-history",
  "agent-composer-input",
  "agent-composer-send",
  "agent-review-slot",
] as const;

export type AgentPanelFocusTarget = (typeof AGENT_PANEL_FOCUS_TARGETS)[number];

export type AgentPanelKeyboardDirection = "next" | "previous";

export interface AgentPanelKeyboardEvent {
  key: string;
  shiftKey?: boolean;
}

export function isAgentPanelFocusTarget(value: unknown): value is AgentPanelFocusTarget {
  return (
    typeof value === "string" &&
    (AGENT_PANEL_FOCUS_TARGETS as readonly string[]).includes(value)
  );
}

export function assertAgentPanelFocusTarget(value: unknown): AgentPanelFocusTarget {
  if (isAgentPanelFocusTarget(value)) {
    return value;
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Controle de foco inválido no painel do agente: ${String(value)}.`,
    [`focusedControl=${String(value)}`],
  );
}

export function resolveAgentPanelFocusNeighbor(
  current: AgentPanelFocusTarget,
  direction: AgentPanelKeyboardDirection,
): AgentPanelFocusTarget {
  const index = AGENT_PANEL_FOCUS_TARGETS.indexOf(current);
  const fallback = AGENT_PANEL_FOCUS_TARGETS[0];
  if (index < 0) {
    return fallback;
  }
  const length = AGENT_PANEL_FOCUS_TARGETS.length;
  const nextIndex =
    direction === "next"
      ? (index + 1) % length
      : (index - 1 + length) % length;
  const neighbor = AGENT_PANEL_FOCUS_TARGETS[nextIndex];
  return neighbor ?? fallback;
}

/**
 * Tab / Shift+Tab / setas move o foco entre controles do painel.
 * Tecla não reconhecida → INVALID_STATE sem efeito.
 */
export function resolveAgentPanelKeyboardDirection(
  event: AgentPanelKeyboardEvent,
): AgentPanelKeyboardDirection {
  const key = event.key;
  if (key === "Tab") {
    return event.shiftKey === true ? "previous" : "next";
  }
  if (key === "ArrowDown" || key === "ArrowRight") {
    return "next";
  }
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return "previous";
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Tecla de navegação inválida no painel do agente: ${key}.`,
    [`key=${key}`],
  );
}
