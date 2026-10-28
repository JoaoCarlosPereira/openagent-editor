import {
  DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS,
  LocalHookEngine,
  type LocalHookEngineOptions,
  type RegisteredLocalHook,
} from "@openagent/policy";

/** Registro de hooks de customização por workspace (CUS-03). */
export class WorkspaceCustomizationHooks {
  private readonly engine: LocalHookEngine;

  constructor(initial: RegisteredLocalHook[] = [], options?: LocalHookEngineOptions) {
    this.engine = new LocalHookEngine(initial, {
      handlerTimeoutMs: options?.handlerTimeoutMs ?? DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS,
    });
  }

  getEngine(): LocalHookEngine {
    return this.engine;
  }

  registerLocalHook(hook: RegisteredLocalHook): void {
    this.engine.register(hook);
  }
}

export function createWorkspaceCustomizationHooks(): WorkspaceCustomizationHooks {
  return new WorkspaceCustomizationHooks();
}
