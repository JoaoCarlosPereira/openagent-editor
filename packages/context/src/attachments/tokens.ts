import { PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import type { ContextTokenLimitValidationResult } from "./types.js";

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

/** Teto padrão documentado em API-03. */
export const DEFAULT_CONTEXT_TOKEN_LIMIT = 200_000 as const;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function resolveContextTokenLimit(configured: unknown): number {
  if (isPositiveInteger(configured)) {
    return configured;
  }
  return DEFAULT_CONTEXT_TOKEN_LIMIT;
}

/**
 * Lê o teto persistido em workspace.context_limit (null = API-03 default).
 */
export function resolveStoredWorkspaceContextLimit(
  stored: number | null | undefined,
): number {
  if (stored === null || stored === undefined) {
    return DEFAULT_CONTEXT_TOKEN_LIMIT;
  }
  return resolveContextTokenLimit(stored);
}

/**
 * Valida entrada explícita de teto antes de persistir (API-03 caminho de erro).
 */
export function validateContextTokenLimitInput(
  raw: unknown,
): ContextTokenLimitValidationResult {
  if (!isPositiveInteger(raw)) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: [
        "contextLimitTokens deve ser inteiro positivo quando informado.",
      ],
    };
  }
  return { valid: true, value: raw };
}
