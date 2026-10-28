import {
  invokeLocalCustomizationWithGrantPolicy,
  type LocalCustomizationInvocationOutcome,
} from "@openagent/policy";

import {
  WorkspaceLocalCustomizationAssets,
  type LoadWorkspaceLocalCustomizationInput,
} from "./local-customization-loader.js";

export type InvokeWorkspaceLocalCustomizationInput = {
  invokeRef: string;
  sessionId: string;
  loadInput: LoadWorkspaceLocalCustomizationInput;
  emittedAt?: number;
};

/** Invoca ativo local carregado do workspace com policy de grant (CUS-02). */
export function invokeWorkspaceLocalCustomization(
  assetsRegistry: WorkspaceLocalCustomizationAssets,
  input: InvokeWorkspaceLocalCustomizationInput,
): LocalCustomizationInvocationOutcome {
  assetsRegistry.reload(input.loadInput);
  const loaded = assetsRegistry.listLoaded();
  return invokeLocalCustomizationWithGrantPolicy(loaded, input.invokeRef, {
    sessionId: input.sessionId,
    emittedAt: input.emittedAt,
  });
}
