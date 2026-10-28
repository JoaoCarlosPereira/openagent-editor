import {
  assertCapabilityAllowedForExecutionMode,
  RunToolPermissionFlow,
  type ExecutionMode,
  type PolicyCapability,
  type RunToolPermissionPrepareResult,
} from "@openagent/policy";

import {
  describeSandboxCapability,
  type DescribeSandboxCapabilityOptions,
  type SandboxCapabilitySnapshot,
} from "./sandbox-capability.js";

export interface SandboxToolDispatchInput {
  runId: string;
  sessionId: string;
  executionMode: ExecutionMode;
  capability: PolicyCapability;
  target: unknown;
  requestId: string;
}

export interface SandboxToolDispatchPrepareResult {
  sandbox: SandboxCapabilitySnapshot;
  permission: RunToolPermissionPrepareResult;
}

/**
 * Combina detecção de sandbox, PER-03 (modo de execução) e PER-01 (pedido de permissão).
 */
export function prepareSandboxToolDispatch(
  flow: RunToolPermissionFlow,
  input: SandboxToolDispatchInput,
  options?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForExecutionMode(input.executionMode, input.capability);
  const sandbox = describeSandboxCapability(options);
  const permission = flow.requestPermission({
    runId: input.runId,
    sessionId: input.sessionId,
    request: {
      requestId: input.requestId,
      capability: input.capability,
      target: input.target,
    },
  });
  return { sandbox, permission };
}

/** Aviso de degradação a exibir no diálogo de permissão antes do aceite. */
export function sandboxDegradationNoticeForPermission(
  snapshot: SandboxCapabilitySnapshot,
): string | undefined {
  if (snapshot.level === "native") {
    return undefined;
  }
  return snapshot.degradationNotice;
}
