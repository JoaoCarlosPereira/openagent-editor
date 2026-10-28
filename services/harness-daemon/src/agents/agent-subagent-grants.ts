import { randomUUID } from "node:crypto";
import {
  InMemoryGrantRegistry,
  issuePermissionGrantFromGate,
  type PermissionGrantContext,
  prepareInheritedSubagentToolPermission,
  type BeginRunToolPermissionInput,
  type PermissionExecutionGate,
  type RunToolPermissionPrepareResult,
} from "@openagent/policy";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export type RunGrantRegistryMap = Map<string, InMemoryGrantRegistry>;

export function runGrantRegistryForContext(
  context: DaemonRpcContext,
  runId: string,
): InMemoryGrantRegistry {
  if (!context.runGrantRegistries) {
    context.runGrantRegistries = new Map();
  }
  let registry = context.runGrantRegistries.get(runId);
  if (!registry) {
    registry = new InMemoryGrantRegistry();
    context.runGrantRegistries.set(runId, registry);
  }
  return registry;
}

export function buildRunGrantContext(
  context: DaemonRpcContext,
  sessionId: string,
  nowMs: number = Date.now(),
): PermissionGrantContext {
  return {
    nowMs,
    sessionId,
    workspaceId: context.binding.workspaceId,
  };
}

export function recordParentRunToolGrant(
  context: DaemonRpcContext,
  runId: string,
  sessionId: string,
  gate: PermissionExecutionGate,
  grantId: string = randomUUID(),
): void {
  if (gate.phase !== "resolved" || gate.decision !== "allow") {
    return;
  }
  const registry = runGrantRegistryForContext(context, runId);
  const grant = issuePermissionGrantFromGate(
    gate,
    grantId,
    buildRunGrantContext(context, sessionId),
  );
  registry.register(grant);
}

export function prepareSubagentRunToolPermission(
  context: DaemonRpcContext,
  input: BeginRunToolPermissionInput,
  declaredCapabilities: readonly string[] = [],
): RunToolPermissionPrepareResult {
  const runId = String(input.runId).trim();
  const sessionId = String(input.sessionId).trim();
  return prepareInheritedSubagentToolPermission(input, {
    parentGrants: runGrantRegistryForContext(context, runId),
    grantContext: buildRunGrantContext(context, sessionId),
    declaredCapabilities,
  });
}
