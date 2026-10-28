import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

/** Camada de origem da regra (CUS-01). */
export type CustomizationRuleLayer = "user" | "project";

export interface LoadedCustomizationRule {
  id: string;
  layer: CustomizationRuleLayer;
  /** Caminho exibível da origem (ex.: `.cursor/rules/team.mdc`). */
  origin: string;
  content: string;
  /** Maior valor = maior precedência na mesclagem. */
  precedence: number;
}

export interface CustomizationRuleDisplayEntry {
  ruleId: string;
  layer: CustomizationRuleLayer;
  origin: string;
  precedence: number;
}

const RULES_REF_PATTERN = /^rules:[a-zA-Z0-9._/-]+$/;

export function validateSessionRulesLoadInput(input: {
  workspaceRoot: string;
  rulesRef: string;
}): void {
  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Contexto de regras inválido.",
      ["Campo 'workspaceRoot' ausente ou inválido."],
    );
  }
  const rulesRef = input.rulesRef.trim();
  if (!rulesRef || !RULES_REF_PATTERN.test(rulesRef)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Referência de regras inválida.",
      ["Campo 'rulesRef' deve seguir rules:{nome}."],
    );
  }
}

/**
 * Mescla regras de usuário e projeto: projeto sobrescreve usuário com o mesmo id
 * e recebe precedência maior (CUS-01).
 */
export function mergeCustomizationRulesByPrecedence(
  userRules: readonly LoadedCustomizationRule[],
  projectRules: readonly LoadedCustomizationRule[],
): LoadedCustomizationRule[] {
  const merged = new Map<string, LoadedCustomizationRule>();
  for (const rule of userRules) {
    merged.set(rule.id, { ...rule, precedence: 1, layer: "user" });
  }
  for (const rule of projectRules) {
    merged.set(rule.id, { ...rule, precedence: 2, layer: "project" });
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.precedence - right.precedence || left.id.localeCompare(right.id),
  );
}

/** Lista regras carregadas com origem de cada uma para exibição (CUS-01). */
export function formatCustomizationRulesForDisplay(
  rules: readonly LoadedCustomizationRule[],
): CustomizationRuleDisplayEntry[] {
  return rules.map((rule) => ({
    ruleId: rule.id,
    layer: rule.layer,
    origin: rule.origin,
    precedence: rule.precedence,
  }));
}
