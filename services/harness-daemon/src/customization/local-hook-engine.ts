import {
  LocalHookEngine,
  type RegisteredLocalHook,
} from "@openagent/policy";

/** Registro de hooks de customização por workspace (CUS-03). */
export class WorkspaceCustomizationHooks {
  private readonly engine: LocalHookEngine;

  constructor(initial: RegisteredLocalHook[] = []) {
    this.engine = new LocalHookEngine(initial);
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
