/**
 * Estimativa conservadora de tokens quando o provedor ainda não informa tokenizador
 * (TechSpec — orçamento por tokens com fallback indicado na UI).
 */
export function estimateContextTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Teto padrão documentado em API-03; task_85 persiste override por workspace. */
export const DEFAULT_CONTEXT_TOKEN_LIMIT = 200_000 as const;

export function resolveContextTokenLimit(configured: unknown): number {
  if (
    typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured > 0
  ) {
    return configured;
  }
  return DEFAULT_CONTEXT_TOKEN_LIMIT;
}
