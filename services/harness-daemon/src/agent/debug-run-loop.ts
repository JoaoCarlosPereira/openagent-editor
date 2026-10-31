import { DatabaseSync } from "node:sqlite";
import type { AgentMode, HarnessEvent } from "@openagent/protocol";
import { assertRunToolMayExecute, persistHarnessEventWithPayload, RunToolPermissionFlow } from "@openagent/policy";
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
import type { DebugSessionBundle, DebugVerification } from "./debug-mode-input.js";

export const DEBUG_HYPOTHESIS_EVENT = "debug.hypothesis";
export const DEBUG_EVIDENCE_EVENT = "debug.evidence";
export const DEBUG_VERIFICATION_EVENT = "debug.verification";

export type DebugRunLoopInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  session: DebugSessionBundle;
  machine: RunStateMachine;
};

export type DebugRunLoopResult = {
  events: HarnessEvent[];
};

const DEBUG_AGENT_MODE: AgentMode = "debug";

function withSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

function persistRunHypothesis(db: WorkspaceDatabase, runId: string, hypothesis: string): void {
  withSqlite(db, (sqlite) => {
    sqlite.prepare(`UPDATE run SET hypothesis = ? WHERE id = ?`).run(hypothesis, runId);
  });
}

function toolContext(workspaceRoot: string): PolicyFileToolContext {
  return {
    workspaceRoot,
    agentMode: DEBUG_AGENT_MODE,
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
  input: DebugRunLoopInput,
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
  input: DebugRunLoopInput,
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

function executeEvidencePlan(input: DebugRunLoopInput, plan: AskLoopPlan): HarnessEvent[] {
  assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);

  const flow = new RunToolPermissionFlow();
  const ctx = toolContext(input.workspaceRoot);
  const events: HarnessEvent[] = [];

  for (const turn of plan.turns) {
    for (const call of turn.toolCalls) {
      assertMayDispatchToolForLifecycle(input.machine.snapshot().lifecycleState);
      if (call.tool === "file.read") {
        events.push(executeReadCall(flow, ctx, input, call));
        continue;
      }
      events.push(executeSearchCall(flow, ctx, input, call));
    }
  }

  return events;
}

function recordVerificationEvent(
  db: WorkspaceDatabase,
  runId: string,
  sessionId: string,
  verification: DebugVerification,
): HarnessEvent {
  return persistHarnessEventWithPayload(db, runId, DEBUG_VERIFICATION_EVENT, {
    type: DEBUG_VERIFICATION_EVENT,
    runId,
    sessionId,
    outcome: verification.outcome,
    summary: verification.summary,
  });
}

/**
 * AGT-04: registra hipótese, evidência de execução e verificação antes de concluir o run.
 */
export function executeDebugRun(input: DebugRunLoopInput): DebugRunLoopResult {
  const events: HarnessEvent[] = [];

  persistRunHypothesis(input.db, input.runId, input.session.hypothesis);
  events.push(
    persistHarnessEventWithPayload(input.db, input.runId, DEBUG_HYPOTHESIS_EVENT, {
      type: DEBUG_HYPOTHESIS_EVENT,
      runId: input.runId,
      sessionId: input.sessionId,
      hypothesis: input.session.hypothesis,
    }),
  );

  const toolEvents = executeEvidencePlan(input, input.session.evidence);
  events.push(...toolEvents);

  const invocationIds = input.session.evidence.turns.flatMap((turn) =>
    turn.toolCalls.map((call) => call.invocationId),
  );
  events.push(
    persistHarnessEventWithPayload(input.db, input.runId, DEBUG_EVIDENCE_EVENT, {
      type: DEBUG_EVIDENCE_EVENT,
      runId: input.runId,
      sessionId: input.sessionId,
      invocationIds,
      toolResultCount: toolEvents.length,
    }),
  );

  events.push(
    recordVerificationEvent(
      input.db,
      input.runId,
      input.sessionId,
      input.session.verification,
    ),
  );

  completeRunningRunLifecycle(input.context, input.runId);

  return { events };
}
