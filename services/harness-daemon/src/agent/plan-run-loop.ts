import type { HarnessEvent } from "@openagent/protocol";
import { persistHarnessEventWithPayload } from "@openagent/policy";
import type { WorkspaceDatabase } from "@openagent/storage";

import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { completeRunningRunLifecycle } from "../runs/run-rpc-handler.js";
import type { RunStateMachine } from "../state/run-state-machine.js";
import type { AgentLoopPlan } from "./agent-loop-plan.js";
import { executeAgentRunLoop } from "./agent-run-loop.js";
import type { PlanAcceptPayload, PlanDraftArtifact } from "./plan-mode-input.js";

export const PLAN_PRESENTED_EVENT = "plan.presented";
export const PLAN_ACCEPTED_EVENT = "plan.accepted";
export const PLAN_PROGRESS_EVENT = "plan.progress";

export type PlanDraftRunInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  draft: PlanDraftArtifact;
  machine: RunStateMachine;
};

export type PlanAcceptedRunInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  accept: PlanAcceptPayload;
  agentLoop: AgentLoopPlan;
  machine: RunStateMachine;
};

export type PlanRunLoopResult = {
  events: HarnessEvent[];
};

/**
 * AGT-02: apresenta o plano como artefato persistido antes de qualquer execução de ferramenta.
 */
export function presentPlanDraftRun(input: PlanDraftRunInput): PlanRunLoopResult {
  const presented = persistHarnessEventWithPayload(input.db, input.runId, PLAN_PRESENTED_EVENT, {
    type: PLAN_PRESENTED_EVENT,
    runId: input.runId,
    sessionId: input.sessionId,
    planId: input.draft.planId,
    title: input.draft.title,
    steps: input.draft.steps,
  });
  completeRunningRunLifecycle(input.context, input.runId);
  return { events: [presented] };
}

/**
 * AGT-02: após aceite, executa o agentLoop com plano e progresso visíveis nos eventos.
 */
export function executePlanAcceptedRun(input: PlanAcceptedRunInput): PlanRunLoopResult {
  const events: HarnessEvent[] = [];
  const accepted = persistHarnessEventWithPayload(input.db, input.runId, PLAN_ACCEPTED_EVENT, {
    type: PLAN_ACCEPTED_EVENT,
    runId: input.runId,
    sessionId: input.sessionId,
    planId: input.accept.planId,
    title: input.accept.title,
    steps: input.accept.steps,
  });
  events.push(accepted);

  const totalSteps = input.accept.steps.length;
  for (let turnIndex = 0; turnIndex < input.agentLoop.turns.length; turnIndex += 1) {
    const turn = input.agentLoop.turns[turnIndex];
    const step = input.accept.steps[turnIndex];
    if (turn === undefined || step === undefined) {
      break;
    }
    const turnResult = executeAgentRunLoop({
      context: input.context,
      db: input.db,
      sessionId: input.sessionId,
      runId: input.runId,
      agentMode: "plan",
      workspaceRoot: input.workspaceRoot,
      plan: { turns: [turn] },
      machine: input.machine,
      deferRunCompletion: turnIndex < input.agentLoop.turns.length - 1,
    });
    events.push(...turnResult.events);

    const completedStepIds = input.accept.steps.slice(0, turnIndex + 1).map((item) => item.stepId);
    const progress = persistHarnessEventWithPayload(input.db, input.runId, PLAN_PROGRESS_EVENT, {
      type: PLAN_PROGRESS_EVENT,
      runId: input.runId,
      planId: input.accept.planId,
      currentStepId: step.stepId,
      currentStepLabel: step.label,
      completedStepIds,
      completedCount: turnIndex + 1,
      totalSteps,
      progressRatio: (turnIndex + 1) / totalSteps,
    });
    events.push(progress);
  }

  return { events };
}
