import {
  EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  assertCapabilityAllowedForExecutionMode,
  describeCapabilityAction,
  formatPolicyTargetDisplay,
  validateExecutionMode,
  validatePolicyCapability,
  validatePolicyTarget,
  type ExecutionMode,
  type PolicyCapability,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

import {
  buildReadOnlyBlockView,
  type ReadOnlyBlockViewSnapshot,
} from "./read-only-block-view.js";

export type { ReadOnlyBlockViewSnapshot } from "./read-only-block-view.js";
export { buildReadOnlyBlockView } from "./read-only-block-view.js";

export interface ReadOnlyBlockAttemptInput {
  executionMode: unknown;
  capability: unknown;
  target?: unknown;
}

export type ReadOnlyBlockAttemptResult =
  | { outcome: "allowed"; executionMode: ExecutionMode; capability: PolicyCapability }
  | {
      outcome: "blocked";
      executionMode: ExecutionMode;
      capability: PolicyCapability;
      view: ReadOnlyBlockViewSnapshot;
      error: ProtocolError;
    };

function resolveAttemptInput(input: ReadOnlyBlockAttemptInput): {
  executionMode: ExecutionMode;
  capability: PolicyCapability;
  targetLabel: string;
} {
  const modeResult = validateExecutionMode(input.executionMode);
  if (!modeResult.valid) {
    throw new ProtocolError("INVALID_STATE", "Modo de execução inválido.", modeResult.errors);
  }
  const capabilityResult = validatePolicyCapability(input.capability);
  if (!capabilityResult.valid) {
    throw new ProtocolError("INVALID_STATE", "Capability inválida.", capabilityResult.errors);
  }
  let targetLabel = "—";
  if (input.target !== undefined) {
    const targetResult = validatePolicyTarget(input.target);
    if (!targetResult.valid) {
      throw new ProtocolError("INVALID_STATE", "Alvo inválido.", targetResult.errors);
    }
    targetLabel = formatPolicyTargetDisplay(targetResult.value);
  }
  return {
    executionMode: modeResult.value,
    capability: capabilityResult.value,
    targetLabel,
  };
}

/** PER-03: avalia policy e produz aviso de UI quando mutação é bloqueada em Somente leitura. */
export function evaluateReadOnlyExecutionBlock(
  input: ReadOnlyBlockAttemptInput,
): ReadOnlyBlockAttemptResult {
  const resolved = resolveAttemptInput(input);
  try {
    assertCapabilityAllowedForExecutionMode(resolved.executionMode, resolved.capability);
  } catch (error) {
    if (!(error instanceof ProtocolError) || error.code !== "PERMISSION_DENIED") {
      throw error;
    }
    const action = describeCapabilityAction(resolved.capability);
    const view = buildReadOnlyBlockView({
      action,
      target: resolved.targetLabel,
      message: EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
    });
    return {
      outcome: "blocked",
      executionMode: resolved.executionMode,
      capability: resolved.capability,
      view,
      error,
    };
  }
  return {
    outcome: "allowed",
    executionMode: resolved.executionMode,
    capability: resolved.capability,
  };
}

/**
 * PER-03: mantém o último bloqueio visível na UI enquanto o modo for Somente leitura.
 */
export class ReadOnlyExecutionBlockController {
  private visibleBlock: ReadOnlyBlockViewSnapshot | undefined;

  get isBlockedVisible(): boolean {
    return this.visibleBlock !== undefined;
  }

  currentView(): ReadOnlyBlockViewSnapshot | undefined {
    return this.visibleBlock;
  }

  clear(): void {
    this.visibleBlock = undefined;
  }

  attempt(input: ReadOnlyBlockAttemptInput): ReadOnlyBlockAttemptResult {
    const result = evaluateReadOnlyExecutionBlock(input);
    if (result.outcome === "blocked") {
      this.visibleBlock = result.view;
    } else {
      this.visibleBlock = undefined;
    }
    return result;
  }
}
