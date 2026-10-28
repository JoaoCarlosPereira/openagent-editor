import type {
  CustomizationRuleDisplayEntry,
  HookDenialDisplay,
  LocalCustomizationAssetKind,
  LocalCustomizationInvokeDisplay,
} from "@openagent/policy";

/** CUS-01 / CUS-02 / CUS-03: painel de regras, skills e justificativa de hook. */

export type CustomizationOriginPhase =
  | "idle"
  | "rules_loaded"
  | "asset_invoked"
  | "hook_denied";

export interface CustomizationOriginViewInput {
  phase: CustomizationOriginPhase;
  message: string;
  rules: readonly CustomizationRuleDisplayEntry[];
  invoked: {
    invokeRef: string;
    instruction: string;
    display: LocalCustomizationInvokeDisplay;
  } | null;
  hookDenial: HookDenialDisplay | null;
  actionBlocked: boolean;
}

export interface CustomizationOriginViewSnapshot {
  html: string;
  accessible: {
    phase: CustomizationOriginPhase;
    message: string;
    rules: readonly CustomizationRuleDisplayEntry[];
    invokedKind: LocalCustomizationAssetKind | null;
    invokedOrigin: string | null;
    invokedInstruction: string | null;
    hookJustification: string | null;
    hookSource: string | null;
    actionBlocked: boolean;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildCustomizationOriginView(
  input: CustomizationOriginViewInput,
): CustomizationOriginViewSnapshot {
  const rulesList =
    input.rules.length > 0
      ? `<ul data-testid="customization-rules-list">${input.rules
          .map(
            (rule) =>
              `<li data-testid="customization-rule" data-rule-id="${escapeHtml(rule.ruleId)}" data-layer="${escapeHtml(rule.layer)}">` +
              `<span data-testid="customization-rule-id">${escapeHtml(rule.ruleId)}</span>` +
              `<span data-testid="customization-rule-origin">${escapeHtml(rule.origin)}</span>` +
              `</li>`,
          )
          .join("")}</ul>`
      : `<ul data-testid="customization-rules-list" data-empty="true"></ul>`;

  const invokedBlock =
    input.invoked !== null
      ? [
          `<div data-testid="customization-invoked" data-kind="${escapeHtml(input.invoked.display.kind)}">`,
          `<span data-testid="customization-invoked-ref">${escapeHtml(input.invoked.invokeRef)}</span>`,
          `<span data-testid="customization-invoked-origin">${escapeHtml(input.invoked.display.origin)}</span>`,
          `<p data-testid="customization-invoked-instruction">${escapeHtml(input.invoked.instruction)}</p>`,
          `</div>`,
        ].join("")
      : "";

  const denialBlock =
    input.hookDenial !== null
      ? [
          `<aside role="alert" data-testid="customization-hook-denial" data-blocked="true">`,
          `<span data-testid="customization-hook-id">${escapeHtml(input.hookDenial.hookId)}</span>`,
          `<span data-testid="customization-hook-source">${escapeHtml(input.hookDenial.hookSource)}</span>`,
          `<p data-testid="customization-hook-justification">${escapeHtml(input.hookDenial.justification)}</p>`,
          `</aside>`,
        ].join("")
      : "";

  const html = [
    `<section role="region" data-testid="customization-origin" data-phase="${escapeHtml(input.phase)}" data-action-blocked="${input.actionBlocked ? "true" : "false"}" aria-label="Regras, skills e hooks">`,
    `<p data-testid="customization-origin-message">${escapeHtml(input.message)}</p>`,
    rulesList,
    invokedBlock,
    denialBlock,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      phase: input.phase,
      message: input.message,
      rules: input.rules,
      invokedKind: input.invoked?.display.kind ?? null,
      invokedOrigin: input.invoked?.display.origin ?? null,
      invokedInstruction: input.invoked?.instruction ?? null,
      hookJustification: input.hookDenial?.justification ?? null,
      hookSource: input.hookDenial?.hookSource ?? null,
      actionBlocked: input.actionBlocked,
    },
  };
}
