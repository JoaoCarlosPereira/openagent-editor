import type { HookDenialDisplay, LocalHookEvaluationResult } from "./types.js";

/** Formata negação de hook para exibição no produto (CUS-03). */
export function formatHookDenialForDisplay(
  result: Extract<LocalHookEvaluationResult, { decision: "deny" }>,
): HookDenialDisplay {
  return {
    blocked: true,
    hookId: result.hookId,
    hookSource: result.hookSource,
    justification: result.justification,
    message: result.justification,
  };
}
