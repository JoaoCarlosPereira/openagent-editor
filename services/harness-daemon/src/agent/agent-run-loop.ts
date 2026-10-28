import type { AgentMode, HarnessEvent } from "@openagent/protocol";
import {
  assertRunToolMayExecute,
  persistHarnessEventWithPayload,
  RunToolPermissionFlow,
} from "@openagent/policy";
import type { WorkspaceDatabase } from "@openagent/storage";
import {
  executeAgentFileWriteBatch,
  executePolicyShellExec,
  formatAgentShellToolResult,
  persistToolInvocationResult,
  preparePolicyFileWrite,
  preparePolicyShellExec,
  snapshotWorkspaceFileForWrite,
  summarizeAgentFileWriteBatch,
  type PolicyFileToolContext,
  type PolicyShellToolContext,
} from "@openagent/tools";

import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { completeRunningRunLifecycle } from "../runs/run-rpc-handler.js";
import { assertMayDispatchToolForLifecycle } from "../state/terminal-run-tool-guard.js";
import type { RunStateMachine } from "../state/run-state-machine.js";
import type { AgentLoopPlan, AgentLoopToolCall } from "./agent-loop-plan.js";

export const DIFF_GROUPED_EVENT = "diff.grouped";

export type AgentRunLoopInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  agentMode: AgentMode;
  workspaceRoot: string;
  plan: AgentLoopPlan;
  machine: RunStateMachine;
};

export type AgentRunLoopResult = {
  events: HarnessEvent[];
};

function toolContext(
  workspaceRoot: string,
  agentMode: AgentMode,
): PolicyFileToolContext & PolicyShellToolContext {
  return {
    workspaceRoot,
    agentMode,
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

function executeWriteBatchCall(
  flow: RunToolPermissionFlow,
  ctx: PolicyFileToolContext,
  input: AgentRunLoopInput,
  call: Extract<AgentLoopToolCall, { tool: "file.write.batch" }>,
): { batchResult: ReturnType<typeof executeAgentFileWriteBatch>; events: HarnessEvent[] } {
  const events: HarnessEvent[] = [];
  for (const operation of call.operations) {
    const prepared = preparePolicyFileWrite(flow, ctx, {
      runId: input.runId,
      sessionId: input.sessionId,
      requestId: `${call.permissionRequestId}-${operation.relativePath}`,
      relativePath: operation.relativePath,
    });
    if (prepared.permission.phase === "pending") {
      grantToolPermission(
        flow,
        input.runId,
        input.sessionId,
        prepared.permission.request.requestId,
      );
    }
    snapshotWorkspaceFileForWrite(input.workspaceRoot, operation.relativePath);
  }

  const batch = executeAgentFileWriteBatch(input.workspaceRoot, input.agentMode, call.operations);
  const summary = summarizeAgentFileWriteBatch(batch);

  const writeEvent = persistToolInvocationResult(input.db, {
    runId: input.runId,
    invocation: {
      id: call.invocationId,
      tool: call.tool,
      target: input.workspaceRoot,
      capability: "file.write",
      state: summary.conflictCount > 0 ? "conflict" : "completed",
    },
    result: {
      appliedCount: summary.appliedCount,
      conflictCount: summary.conflictCount,
      groupedDiffPreview: batch.groupedDiff.slice(0, 500),
    },
  });
  events.push(writeEvent.event);

  const diffEvent = persistHarnessEventWithPayload(
    input.db,
    input.runId,
    DIFF_GROUPED_EVENT,
    {
      type: DIFF_GROUPED_EVENT,
      runId: input.runId,
      groupedDiff: batch.groupedDiff,
      fileCount: summary.appliedCount,
    },
  );
  events.push(diffEvent);

  return { batchResult: batch, events };
}

function executeShellCall(
  flow: RunToolPermissionFlow,
  ctx: PolicyShellToolContext,
  input: AgentRunLoopInput,
  call: Extract<AgentLoopToolCall, { tool: "shell.exec" }>,
): HarnessEvent {
  const prepared = preparePolicyShellExec(flow, ctx, {
    runId: input.runId,
    sessionId: input.sessionId,
    requestId: call.permissionRequestId,
    command: call.command,
  });
  if (prepared.permission.phase === "pending") {
    grantToolPermission(flow, input.runId, input.sessionId, prepared.permission.request.requestId);
  }
  const execResult = executePolicyShellExec(input.workspaceRoot, call.command);
  const toolResult = formatAgentShellToolResult(execResult);
  const persisted = persistToolInvocationResult(input.db, {
    runId: input.runId,
    invocation: {
      id: call.invocationId,
      tool: call.tool,
      target: call.command,
      capability: "shell.exec",
      state: "completed",
    },
    result: toolResult,
  });
  return persisted.event;
}

/**
 * AGT-03: loop incremental modelo → ferramentas no daemon (turnos scriptados via agentLoop no UserInput).
 * Integração com streaming real do model-gateway (task_100) entra como driver substituível em tarefa futura.
 */
export function executeAgentRunLoop(input: AgentRunLoopInput): AgentRunLoopResult {
  assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);

  const flow = new RunToolPermissionFlow();
  const ctx = toolContext(input.workspaceRoot, input.agentMode);
  const events: HarnessEvent[] = [];

  for (const turn of input.plan.turns) {
    for (const call of turn.toolCalls) {
      assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);
      if (call.tool === "file.write.batch") {
        const { events: turnEvents } = executeWriteBatchCall(flow, ctx, input, call);
        events.push(...turnEvents);
        continue;
      }
      events.push(executeShellCall(flow, ctx, input, call));
    }
  }

  completeRunningRunLifecycle(input.context, input.runId);

  return { events };
}
