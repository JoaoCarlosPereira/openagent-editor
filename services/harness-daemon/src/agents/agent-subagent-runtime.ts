import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export type SubagentRunHandle = {
  agentId: string;
  runId: string;
  abortController: AbortController;
};

export type SubagentRuntimeRegistry = Map<string, Map<string, SubagentRunHandle>>;

export function subagentRegistryForContext(context: DaemonRpcContext): SubagentRuntimeRegistry {
  if (!context.subagentRuns) {
    context.subagentRuns = new Map();
  }
  return context.subagentRuns;
}

export function registerSubagentRun(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
): AbortController {
  const registry = subagentRegistryForContext(context);
  let runBucket = registry.get(runId);
  if (!runBucket) {
    runBucket = new Map();
    registry.set(runId, runBucket);
  }
  const abortController = new AbortController();
  runBucket.set(agentId, { agentId, runId, abortController });
  return abortController;
}

export function unregisterSubagentRun(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
): void {
  const runBucket = context.subagentRuns?.get(runId);
  runBucket?.delete(agentId);
  if (runBucket && runBucket.size === 0) {
    context.subagentRuns?.delete(runId);
  }
}

export function abortSubagentRun(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
): AbortController | null {
  const handle = context.subagentRuns?.get(runId)?.get(agentId);
  if (!handle) {
    return null;
  }
  handle.abortController.abort();
  return handle.abortController;
}

/** Objetivo de teste: `[delay:ms]` antes do texto real (integração AGT-07). */
export function parseSubagentObjectiveDelay(objective: string): {
  delayMs: number;
  objectiveText: string;
} {
  const match = /^\[delay:(\d+)\]\s*(.*)$/s.exec(objective.trim());
  if (!match) {
    return { delayMs: 0, objectiveText: objective.trim() };
  }
  const delayMs = Number(match[1]);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Parâmetro delay em objective inválido.",
    );
  }
  return { delayMs, objectiveText: (match[2] ?? "").trim() };
}

export async function waitAbortableMs(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, "Subagente cancelado."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
  });
}
