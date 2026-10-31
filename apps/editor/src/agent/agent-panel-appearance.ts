import { ProtocolError } from "@openagent/protocol";

/** UI-02: temas claro e escuro do painel do agente. */
export const AGENT_PANEL_THEMES = ["light", "dark"] as const;

export type AgentPanelTheme = (typeof AGENT_PANEL_THEMES)[number];

export const AGENT_PANEL_THEME_DEFAULT: AgentPanelTheme = "light";

/** Largura do painel em px (UI-02). */
export const AGENT_PANEL_WIDTH_MIN_PX = 280;
export const AGENT_PANEL_WIDTH_MAX_PX = 720;
export const AGENT_PANEL_WIDTH_DEFAULT_PX = 360;

/** Tokens de contraste por tema — controles permanecem legíveis (UI-02). */
export interface AgentPanelThemeTokens {
  background: string;
  foreground: string;
  border: string;
  controlBackground: string;
  controlForeground: string;
}

export const AGENT_PANEL_THEME_TOKENS: Record<
  AgentPanelTheme,
  AgentPanelThemeTokens
> = {
  light: {
    background: "#f7f7f8",
    foreground: "#1a1a1a",
    border: "#d0d0d4",
    controlBackground: "#ffffff",
    controlForeground: "#1a1a1a",
  },
  dark: {
    background: "#1e1e22",
    foreground: "#f2f2f4",
    border: "#3a3a42",
    controlBackground: "#2a2a30",
    controlForeground: "#f2f2f4",
  },
};

export function isAgentPanelTheme(value: unknown): value is AgentPanelTheme {
  return (
    typeof value === "string" &&
    (AGENT_PANEL_THEMES as readonly string[]).includes(value)
  );
}

export function assertAgentPanelTheme(value: unknown): AgentPanelTheme {
  if (isAgentPanelTheme(value)) {
    return value;
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Tema do painel inválido: ${String(value)}. Use: ${AGENT_PANEL_THEMES.join(", ")}.`,
    [`theme=${String(value)}`],
  );
}

/**
 * Largura em px dentro do intervalo permitido.
 * Entrada inválida → INVALID_STATE (UI-02 caminho de erro).
 */
export function assertAgentPanelWidthPx(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Largura do painel deve ser um inteiro em pixels.",
      [`panelWidthPx=${String(value)}`],
    );
  }
  if (value < AGENT_PANEL_WIDTH_MIN_PX || value > AGENT_PANEL_WIDTH_MAX_PX) {
    throw new ProtocolError(
      "INVALID_STATE",
      `Largura do painel fora do intervalo ${AGENT_PANEL_WIDTH_MIN_PX}–${AGENT_PANEL_WIDTH_MAX_PX}px.`,
      [`panelWidthPx=${value}`],
    );
  }
  return value;
}

export function themeTokensCssVariables(theme: AgentPanelTheme): string {
  const tokens = AGENT_PANEL_THEME_TOKENS[theme];
  return [
    `--agent-panel-bg:${tokens.background}`,
    `--agent-panel-fg:${tokens.foreground}`,
    `--agent-panel-border:${tokens.border}`,
    `--agent-panel-control-bg:${tokens.controlBackground}`,
    `--agent-panel-control-fg:${tokens.controlForeground}`,
  ].join(";");
}
