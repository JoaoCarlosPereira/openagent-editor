import { ProtocolError, type AgentMode } from "@openagent/protocol";

export const AGENT_PANEL_MODES: readonly AgentMode[] = ["ask", "plan", "agent", "debug"];

export const AGENT_PANEL_MODE_LABELS: Record<AgentMode, string> = {
  ask: "Ask",
  plan: "Plan",
  agent: "Agent",
  debug: "Debug",
};

export interface AgentPanelModelOption {
  id: string;
  label: string;
}

export const DEFAULT_AGENT_PANEL_MODELS: readonly AgentPanelModelOption[] = [
  { id: "default", label: "Padrão" },
];

export function assertAgentPanelMode(value: unknown): AgentMode {
  if (typeof value === "string" && AGENT_PANEL_MODES.includes(value as AgentMode)) {
    return value as AgentMode;
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Campo 'mode' deve ser um dos modos: ${AGENT_PANEL_MODES.join(", ")}.`,
    [`Campo 'mode' deve ser um dos modos: ${AGENT_PANEL_MODES.join(", ")}.`],
  );
}

export function assertAgentPanelModelId(
  value: unknown,
  availableModels: readonly AgentPanelModelOption[],
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProtocolError("INVALID_STATE", "Campo 'modelId' inválido.", [
      "Campo 'modelId' deve ser string não vazia.",
    ]);
  }
  if (!availableModels.some((option) => option.id === value)) {
    throw new ProtocolError(
      "INVALID_STATE",
      `Modelo '${value}' não está disponível no seletor.`,
      [`Modelo '${value}' não está na lista de modelos oferecidos.`],
    );
  }
  return value;
}
