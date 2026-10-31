import { ProtocolError } from "@openagent/protocol";

import { validatePolicyCapability } from "../capability.js";
import { validatePolicyTarget } from "../target.js";
import {
  invokeRegisteredHookHandler,
  resolveHandlerTimeoutMs,
  type LocalHookEngineOptions,
} from "./timeout.js";
import type {
  LocalHookAction,
  LocalHookEvaluationResult,
  RegisteredLocalHook,
} from "./types.js";

export type { LocalHookEngineOptions } from "./timeout.js";
export { DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS } from "./timeout.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeHookJustification(raw: unknown): string {
  if (!isNonEmptyString(raw)) {
    throw new ProtocolError("INVALID_STATE", "Hook negou sem justificativa válida.", [
      "Campo 'justification' ausente ou vazio.",
    ]);
  }
  return raw.trim();
}

/** Valida contexto de ação antes de executar hooks locais. */
export function validateLocalHookAction(raw: unknown): LocalHookAction {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProtocolError("INVALID_STATE", "Contexto de hook inválido.", [
      "Ação do hook deve ser um objeto.",
    ]);
  }
  const record = raw as Record<string, unknown>;
  const capabilityResult = validatePolicyCapability(record["capability"]);
  if (!capabilityResult.valid) {
    throw new ProtocolError("INVALID_STATE", "Contexto de hook inválido.", capabilityResult.errors);
  }
  const targetResult = validatePolicyTarget(record["target"]);
  if (!targetResult.valid) {
    throw new ProtocolError("INVALID_STATE", "Contexto de hook inválido.", targetResult.errors);
  }

  const action: LocalHookAction = {
    capability: capabilityResult.value,
    target: targetResult.value,
  };

  if (record["runId"] !== undefined) {
    if (!isNonEmptyString(record["runId"])) {
      throw new ProtocolError("INVALID_STATE", "Contexto de hook inválido.", [
        "Campo 'runId' inválido quando informado.",
      ]);
    }
    action.runId = record["runId"].trim();
  }
  if (record["sessionId"] !== undefined) {
    if (!isNonEmptyString(record["sessionId"])) {
      throw new ProtocolError("INVALID_STATE", "Contexto de hook inválido.", [
        "Campo 'sessionId' inválido quando informado.",
      ]);
    }
    action.sessionId = record["sessionId"].trim();
  }

  return action;
}

/** Motor sequencial de hooks locais: primeira negação interrompe a ação (CUS-03). */
export class LocalHookEngine {
  private readonly hooks: RegisteredLocalHook[];
  private readonly handlerTimeoutMs: number;

  constructor(hooks: RegisteredLocalHook[] = [], options?: LocalHookEngineOptions) {
    this.hooks = [...hooks];
    this.handlerTimeoutMs = resolveHandlerTimeoutMs(options);
  }

  register(hook: RegisteredLocalHook): void {
    if (!isNonEmptyString(hook.id)) {
      throw new ProtocolError("INVALID_STATE", "Hook local inválido.", ["Campo 'id' ausente."]);
    }
    if (!isNonEmptyString(hook.source)) {
      throw new ProtocolError("INVALID_STATE", "Hook local inválido.", ["Campo 'source' ausente."]);
    }
    if (typeof hook.handler !== "function") {
      throw new ProtocolError("INVALID_STATE", "Hook local inválido.", ["Campo 'handler' inválido."]);
    }
    this.hooks.push(hook);
  }

  async evaluate(rawAction: unknown): Promise<LocalHookEvaluationResult> {
    const action = validateLocalHookAction(rawAction);
    for (const hook of this.hooks) {
      const invoked = await invokeRegisteredHookHandler(hook, action, this.handlerTimeoutMs);
      if (invoked.kind === "timeout") {
        continue;
      }
      const outcome = invoked.outcome;
      if (outcome.decision === "deny") {
        const justification = normalizeHookJustification(outcome.justification);
        return {
          decision: "deny",
          justification,
          hookId: hook.id,
          hookSource: hook.source,
        };
      }
    }
    return { decision: "allow" };
  }
}

export function hookActionDeniedError(
  result: Extract<LocalHookEvaluationResult, { decision: "deny" }>,
): ProtocolError {
  return new ProtocolError("PERMISSION_DENIED", result.justification, [
    `hookId=${result.hookId}`,
    `hookSource=${result.hookSource}`,
  ]);
}

/** Impede a ação quando algum hook local nega (CUS-03). */
export async function assertLocalHooksAllowAction(
  engine: LocalHookEngine,
  rawAction: unknown,
): Promise<void> {
  const result = await engine.evaluate(rawAction);
  if (result.decision === "deny") {
    throw hookActionDeniedError(result);
  }
}
