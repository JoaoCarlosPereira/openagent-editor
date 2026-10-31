import type { AgentMode, HarnessEvent } from "@openagent/protocol";
import { assertRunToolMayExecute, RunToolPermissionFlow } from "@openagent/policy";
import type { WorkspaceDatabase } from "@openagent/storage";
import {
  executePolicyFileRead,
  executePolicyFileSearch,
  persistToolInvocationResult,
  preparePolicyFileRead,
  preparePolicyFileSearch,
  type PolicyFileToolContext,
} from "@openagent/tools";

import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { completeRunningRunLifecycle } from "../runs/run-rpc-handler.js";
import { assertMayDispatchToolForLifecycle } from "../state/terminal-run-tool-guard.js";
import type { RunStateMachine } from "../state/run-state-machine.js";
import type { AskLoopPlan, AskLoopToolCall } from "./ask-loop-plan.js";

export type AskRunLoopInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  plan: AskLoopPlan;
  machine: RunStateMachine;
};

export type AskRunLoopResult = {
  events: HarnessEvent[];
};

const ASK_AGENT_MODE: AgentMode = "ask";

function toolContext(workspaceRoot: string): PolicyFileToolContext {
  return {
    workspaceRoot,
    agentMode: ASK_AGENT_MODE,
    executionMode: "standard",
  };
}

function grantToolPermission(
  flow: RunToolPermissionFlow,
  runId: string,
  sessionId: string,
  requestId: string,
): void {
  const decided = flow.decide(requestId, "allow", "once");
  assertRunToolMayExecute(decided.gate);
  if (decided.context.runId !== runId || decided.context.sessionId !== sessionId) {
    throw new Error("Contexto de permissão divergente do run.");
  }
}

function executeReadCall(
  flow: RunToolPermissionFlow,
  ctx: PolicyFileToolContext,
  input: AskRunLoopInput,
  call: Extract<AskLoopToolCall, { tool: "file.read" }>,
): HarnessEvent {
  const prepared = preparePolicyFileRead(flow, ctx, {
    runId: input.runId,
    sessionId: input.sessionId,
    requestId: call.permissionRequestId,
    relativePath: call.relativePath,
  });
  if (prepared.permission.phase === "pending") {
    grantToolPermission(flow, input.runId, input.sessionId, prepared.permission.request.requestId);
  }
  const readResult = executePolicyFileRead(input.workspaceRoot, call.relativePath);
  const persisted = persistToolInvocationResult(input.db, {
    runId: input.runId,
    invocation: {
      id: call.invocationId,
      tool: call.tool,
      target: call.relativePath,
      capability: "file.read",
      state: "completed",
    },
    result: {
      content: readResult.content,
      path: readResult.path,
      truncated: readResult.truncated,
    },
  });
  return persisted.event;
}

function executeSearchCall(
  flow: RunToolPermissionFlow,
  ctx: PolicyFileToolContext,
  input: AskRunLoopInput,
  call: Extract<AskLoopToolCall, { tool: "file.search" }>,
): HarnessEvent {
  const prepared = preparePolicyFileSearch(flow, ctx, {
    runId: input.runId,
    sessionId: input.sessionId,
    requestId: call.permissionRequestId,
    query: call.query,
  });
  if (prepared.permission.phase === "pending") {
    grantToolPermission(flow, input.runId, input.sessionId, prepared.permission.request.requestId);
  }
  const searchResult = executePolicyFileSearch(input.workspaceRoot, call.query);
  const persisted = persistToolInvocationResult(input.db, {
    runId: input.runId,
    invocation: {
      id: call.invocationId,
      tool: call.tool,
      target: call.query,
      capability: "file.search",
      state: "completed",
    },
    result: {
      hits: searchResult.hits,
      hitCount: searchResult.hits.length,
    },
  });
  return persisted.event;
}

/**
 * AGT-01: loop Ask no daemon — somente leitura e busca; mutação bloqueada na policy.
 */
export function executeAskRunLoop(input: AskRunLoopInput): AskRunLoopResult {
  assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);

  const flow = new RunToolPermissionFlow();
  const ctx = toolContext(input.workspaceRoot);
  const events: HarnessEvent[] = [];

  for (const turn of input.plan.turns) {
    for (const call of turn.toolCalls) {
      assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);
      if (call.tool === "file.read") {
        events.push(executeReadCall(flow, ctx, input, call));
        continue;
      }
      events.push(executeSearchCall(flow, ctx, input, call));
    }
  }

  completeRunningRunLifecycle(input.context, input.runId);

  return { events };
}
