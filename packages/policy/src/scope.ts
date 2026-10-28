import type { GrantScopeKind, PolicyValidationResult } from "./types.js";

export const GRANT_SCOPE_KINDS: readonly GrantScopeKind[] = ["once", "session", "workspace"];

const GRANT_SCOPE_LABELS: Record<GrantScopeKind, string> = {
  once: "Uma vez",
  session: "Esta sessão",
  workspace: "Todo o workspace",
};

function isGrantScopeKind(value: unknown): value is GrantScopeKind {
  return typeof value === "string" && (GRANT_SCOPE_KINDS as readonly string[]).includes(value);
}

export function validateGrantScope(raw: unknown): PolicyValidationResult<GrantScopeKind> {
  if (!isGrantScopeKind(raw)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Escopo inválido; use once, session ou workspace."],
    };
  }
  return { valid: true, value: raw };
}

export function formatGrantScopeLabel(scope: GrantScopeKind): string {
  return GRANT_SCOPE_LABELS[scope];
}

export function validateOfferedScopes(
  raw: unknown,
): PolicyValidationResult<readonly GrantScopeKind[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Lista 'offeredScopes' deve conter ao menos um escopo."],
    };
  }
  const scopes: GrantScopeKind[] = [];
  for (const item of raw) {
    const parsed = validateGrantScope(item);
    if (!parsed.valid) {
      return parsed;
    }
    if (!scopes.includes(parsed.value)) {
      scopes.push(parsed.value);
    }
  }
  return { valid: true, value: scopes };
}
