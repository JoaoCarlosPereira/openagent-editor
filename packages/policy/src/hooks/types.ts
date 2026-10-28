import type { PolicyCapability, PolicyTarget } from "../types.js";

/** Ação observável que hooks locais podem aprovar ou negar (CUS-03). */
export interface LocalHookAction {
  capability: PolicyCapability;
  target: PolicyTarget;
  runId?: string;
  sessionId?: string;
}

export type LocalHookDecision = "allow" | "deny";

export interface LocalHookAllowOutcome {
  decision: "allow";
}

export interface LocalHookDenyOutcome {
  decision: "deny";
  justification: string;
}

export type LocalHookHandlerOutcome = LocalHookAllowOutcome | LocalHookDenyOutcome;

export type LocalHookHandler = (
  action: LocalHookAction,
) => LocalHookHandlerOutcome | Promise<LocalHookHandlerOutcome>;

export interface RegisteredLocalHook {
  id: string;
  /** Origem exibível (ex.: caminho de configuração local). */
  source: string;
  handler: LocalHookHandler;
}

export type LocalHookEvaluationResult =
  | LocalHookAllowOutcome
  | (LocalHookDenyOutcome & {
      hookId: string;
      hookSource: string;
    });

export interface HookDenialDisplay {
  blocked: true;
  hookId: string;
  hookSource: string;
  justification: string;
  /** Texto principal para a UI quando o hook nega a ação (CUS-03). */
  message: string;
}
