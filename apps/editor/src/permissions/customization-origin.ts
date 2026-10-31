import {
  LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE,
  LocalHookEngine,
  SESSION_RULES_LOADED_EVENT_TYPE,
  applyLocalCustomizationInvocation,
  assertLocalHooksAllowAction,
  buildSessionRulesLoadedEmission,
  formatCustomizationRulesForDisplay,
  formatHookDenialForDisplay,
  invokeLocalCustomizationWithGrantPolicy,
  mergeCustomizationRulesByPrecedence,
  mergeLocalCustomizationAssetsByPrecedence,
  parseLocalCustomizationInvokeRef,
  validateLocalHookAction,
  validateSessionRulesLoadInput,
  type CustomizationRuleDisplayEntry,
  type HookDenialDisplay,
  type LoadedCustomizationRule,
  type LoadedLocalCustomizationAsset,
  type LocalCustomizationInvokedEmission,
  type LocalCustomizationInvokeResult,
  type LocalHookAction,
  type SessionRulesLoadedEmission,
} from "@openagent/policy";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  buildCustomizationOriginView,
  type CustomizationOriginPhase,
  type CustomizationOriginViewSnapshot,
} from "./customization-origin-view.js";

export type {
  CustomizationOriginPhase,
  CustomizationOriginViewSnapshot,
} from "./customization-origin-view.js";
export { buildCustomizationOriginView } from "./customization-origin-view.js";

export const CUSTOMIZATION_ORIGIN_IDLE_MESSAGE =
  "Nenhuma regra, skill ou negação de hook exibida ainda." as const;

export const CUSTOMIZATION_ORIGIN_RULES_MESSAGE =
  "Regras de usuário e de projeto carregadas; a origem de cada uma está visível." as const;

export const CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE =
  "Instrução local aplicada; a origem do comando, skill ou plugin está visível." as const;

export const CUSTOMIZATION_ORIGIN_HOOK_DENIED_MESSAGE =
  "Hook local negou a ação; a justificativa está visível e a execução foi impedida." as const;

export type AcceptSessionRulesInput = {
  workspaceRoot: unknown;
  rulesRef: unknown;
  sessionId: unknown;
  userRules?: readonly LoadedCustomizationRule[];
  projectRules?: readonly LoadedCustomizationRule[];
  emittedAt?: number;
};

export type AcceptCustomizationInvokeInput = {
  sessionId: unknown;
  invokeRef: unknown;
  userAssets?: readonly LoadedLocalCustomizationAsset[];
  projectAssets?: readonly LoadedLocalCustomizationAsset[];
  assets?: readonly LoadedLocalCustomizationAsset[];
  emittedAt?: number;
};

export type AttemptHookGuardedActionResult =
  | { outcome: "allowed"; action: LocalHookAction }
  | {
      outcome: "blocked";
      action: LocalHookAction;
      denial: HookDenialDisplay;
      view: CustomizationOriginViewSnapshot;
      error: ProtocolError;
    };

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Campo '${field}' inválido para customização na UI.`,
      [field],
    );
  }
  return value.trim();
}

/**
 * CUS-01 / CUS-02 / CUS-03: UI mostra origem de regras e skills e justificativa de hook.
 */
export class CustomizationOriginController {
  private view: CustomizationOriginViewSnapshot;
  private rules: CustomizationRuleDisplayEntry[] = [];
  private lastRulesEmission: SessionRulesLoadedEmission | null = null;
  private lastInvoked: {
    invokeRef: string;
    instruction: string;
    display: LocalCustomizationInvokeResult["display"];
  } | null = null;
  private lastInvokedEmission: LocalCustomizationInvokedEmission | null = null;
  private lastHookDenial: HookDenialDisplay | null = null;
  private readonly hookEngine: LocalHookEngine;

  constructor(hookEngine?: LocalHookEngine) {
    this.hookEngine = hookEngine ?? new LocalHookEngine();
    this.view = this.buildIdleView();
  }

  get snapshot(): CustomizationOriginViewSnapshot {
    return this.view;
  }

  get phase(): CustomizationOriginPhase {
    return this.view.accessible.phase;
  }

  get rulesLoaded(): SessionRulesLoadedEmission | null {
    return this.lastRulesEmission;
  }

  get lastInvocation(): LocalCustomizationInvokedEmission | null {
    return this.lastInvokedEmission;
  }

  get isActionBlocked(): boolean {
    return this.view.accessible.actionBlocked;
  }

  get hookEngineInstance(): LocalHookEngine {
    return this.hookEngine;
  }

  /**
   * CUS-01: ao iniciar sessão, carrega regras aplicáveis e exibe origem de cada uma.
   */
  acceptSessionRulesLoaded(input: AcceptSessionRulesInput): CustomizationOriginViewSnapshot {
    const workspaceRoot = requireNonEmptyString(input.workspaceRoot, "workspaceRoot");
    const rulesRef = requireNonEmptyString(input.rulesRef, "rulesRef");
    const sessionId = requireNonEmptyString(input.sessionId, "sessionId");
    validateSessionRulesLoadInput({ workspaceRoot, rulesRef });

    const merged = mergeCustomizationRulesByPrecedence(
      input.userRules ?? [],
      input.projectRules ?? [],
    );
    const displayRules = formatCustomizationRulesForDisplay(merged);
    const emission = buildSessionRulesLoadedEmission({
      sessionId,
      rulesRef,
      loadedRules: displayRules,
      emittedAt: input.emittedAt,
    });
    if (emission.type !== SESSION_RULES_LOADED_EVENT_TYPE) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Emissão de regras com tipo inesperado.",
        [String(emission.type)],
      );
    }

    this.rules = [...displayRules];
    this.lastRulesEmission = emission;
    this.lastInvoked = null;
    this.lastInvokedEmission = null;
    this.lastHookDenial = null;
    this.view = buildCustomizationOriginView({
      phase: "rules_loaded",
      message: CUSTOMIZATION_ORIGIN_RULES_MESSAGE,
      rules: this.rules,
      invoked: null,
      hookDenial: null,
      actionBlocked: false,
    });
    return this.view;
  }

  /**
   * CUS-02: invoca command/skill/plugin, aplica instrução declarada e mostra origem.
   */
  acceptCustomizationInvoked(
    input: AcceptCustomizationInvokeInput,
  ): CustomizationOriginViewSnapshot {
    const sessionId = requireNonEmptyString(input.sessionId, "sessionId");
    const invokeRef = requireNonEmptyString(input.invokeRef, "invokeRef");
    parseLocalCustomizationInvokeRef(invokeRef);

    const assets =
      input.assets ??
      mergeLocalCustomizationAssetsByPrecedence(input.userAssets ?? [], input.projectAssets ?? []);
    const outcome = invokeLocalCustomizationWithGrantPolicy(assets, invokeRef, {
      sessionId,
      emittedAt: input.emittedAt,
    });
    if (outcome.invoked.type !== LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Emissão de invocação com tipo inesperado.",
        [String(outcome.invoked.type)],
      );
    }
    // Confirma aplicação da instrução declarada (efeito observável CUS-02).
    const applied = applyLocalCustomizationInvocation(assets, invokeRef);
    if (applied.instruction !== outcome.result.instruction) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Instrução aplicada diverge da emissão.",
        [invokeRef],
      );
    }

    this.lastInvoked = {
      invokeRef: outcome.result.invokeRef,
      instruction: outcome.result.instruction,
      display: outcome.result.display,
    };
    this.lastInvokedEmission = outcome.invoked;
    this.lastHookDenial = null;
    this.view = buildCustomizationOriginView({
      phase: "asset_invoked",
      message: CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE,
      rules: this.rules,
      invoked: this.lastInvoked,
      hookDenial: null,
      actionBlocked: false,
    });
    return this.view;
  }

  /**
   * CUS-03: avalia hooks locais; se negar, impede a ação e exibe a justificativa.
   */
  async attemptHookGuardedAction(
    actionRaw: unknown,
  ): Promise<AttemptHookGuardedActionResult> {
    const action = validateLocalHookAction(actionRaw);
    try {
      await assertLocalHooksAllowAction(this.hookEngine, action);
      if (this.phase === "hook_denied") {
        this.lastHookDenial = null;
        this.view = this.rebuildWithoutDenial();
      }
      return { outcome: "allowed", action };
    } catch (error) {
      if (!(error instanceof ProtocolError) || error.code !== PROTOCOL_ERROR_CODES.PERMISSION_DENIED) {
        throw error;
      }
      const evaluation = await this.hookEngine.evaluate(action);
      if (evaluation.decision !== "deny") {
        throw error;
      }
      const denial = formatHookDenialForDisplay(evaluation);
      this.lastHookDenial = denial;
      this.view = buildCustomizationOriginView({
        phase: "hook_denied",
        message: CUSTOMIZATION_ORIGIN_HOOK_DENIED_MESSAGE,
        rules: this.rules,
        invoked: this.lastInvoked,
        hookDenial: denial,
        actionBlocked: true,
      });
      return {
        outcome: "blocked",
        action,
        denial,
        view: this.view,
        error,
      };
    }
  }

  dismiss(): void {
    this.lastHookDenial = null;
    this.lastInvoked = null;
    this.lastInvokedEmission = null;
    this.view = this.buildIdleView();
  }

  private buildIdleView(): CustomizationOriginViewSnapshot {
    return buildCustomizationOriginView({
      phase: "idle",
      message: CUSTOMIZATION_ORIGIN_IDLE_MESSAGE,
      rules: this.rules,
      invoked: null,
      hookDenial: null,
      actionBlocked: false,
    });
  }

  private rebuildWithoutDenial(): CustomizationOriginViewSnapshot {
    if (this.lastInvoked) {
      return buildCustomizationOriginView({
        phase: "asset_invoked",
        message: CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE,
        rules: this.rules,
        invoked: this.lastInvoked,
        hookDenial: null,
        actionBlocked: false,
      });
    }
    if (this.rules.length > 0) {
      return buildCustomizationOriginView({
        phase: "rules_loaded",
        message: CUSTOMIZATION_ORIGIN_RULES_MESSAGE,
        rules: this.rules,
        invoked: null,
        hookDenial: null,
        actionBlocked: false,
      });
    }
    return this.buildIdleView();
  }
}
