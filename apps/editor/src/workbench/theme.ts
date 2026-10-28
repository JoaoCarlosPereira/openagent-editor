import { ProtocolError } from "@openagent/protocol";

/** UI-02: tokens de tema claro/escuro para o workbench (próprios, não herdados). */
export const WORKBENCH_THEMES = ["light", "dark"] as const;

export type WorkbenchTheme = (typeof WORKBENCH_THEMES)[number];

export const WORKBENCH_THEME_DEFAULT: WorkbenchTheme = "light";

/** Largura do painel em px (UI-02). */
export const WORKBENCH_PANEL_WIDTH_MIN_PX = 280;
export const WORKBENCH_PANEL_WIDTH_MAX_PX = 720;
export const WORKBENCH_PANEL_WIDTH_DEFAULT_PX = 360;

/** Tokens visuais por tema — controles permanecem legíveis (UI-02). */
export interface WorkbenchThemeTokens {
  background: string;
  foreground: string;
  border: string;
  controlBackground: string;
  controlForeground: string;
}

export const WORKBENCH_THEME_TOKENS: Record<WorkbenchTheme, WorkbenchThemeTokens> = {
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

export function isWorkbenchTheme(value: unknown): value is WorkbenchTheme {
  return typeof value === "string" && (WORKBENCH_THEMES as readonly string[]).includes(value);
}

export function assertWorkbenchTheme(value: unknown): WorkbenchTheme {
  if (isWorkbenchTheme(value)) {
    return value;
  }
  throw new ProtocolError(
    "INVALID_STATE",
    `Tema do workbench inválido: ${String(value)}. Use: ${WORKBENCH_THEMES.join(", ")}.`,
    [`theme=${String(value)}`],
  );
}

/**
 * Largura em px dentro do intervalo permitido.
 * Entrada inválida → INVALID_STATE (UI-02 caminho de erro).
 */
export function assertWorkbenchPanelWidthPx(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Largura do painel deve ser um inteiro em pixels.",
      [`panelWidthPx=${String(value)}`],
    );
  }
  if (value < WORKBENCH_PANEL_WIDTH_MIN_PX || value > WORKBENCH_PANEL_WIDTH_MAX_PX) {
    throw new ProtocolError(
      "INVALID_STATE",
      `Largura do painel fora do intervalo ${WORKBENCH_PANEL_WIDTH_MIN_PX}–${WORKBENCH_PANEL_WIDTH_MAX_PX}px.`,
      [`panelWidthPx=${value}`],
    );
  }
  return value;
}

/** Gera string de variáveis CSS para o snapshot HTML. */
export function themeTokensCssVariables(theme: WorkbenchTheme): string {
  const tokens = WORKBENCH_THEME_TOKENS[theme];
  return [
    `--workbench-bg:${tokens.background}`,
    `--workbench-fg:${tokens.foreground}`,
    `--workbench-border:${tokens.border}`,
    `--workbench-control-bg:${tokens.controlBackground}`,
    `--workbench-control-fg:${tokens.controlForeground}`,
  ].join(";");
}
