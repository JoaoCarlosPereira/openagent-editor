import type { AgentMode } from "@openagent/protocol";
import type { WorkspaceDatabase } from "@openagent/storage";

import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import type { RunStateMachine } from "../state/run-state-machine.js";
import { tryExtractAgentLoopPlanFromUserText } from "./agent-loop-plan.js";
import { executeAgentRunLoop, type AgentRunLoopResult } from "./agent-run-loop.js";

export type AgentModeRunInput = {
  context: DaemonRpcContext;
  db: WorkspaceDatabase;
  sessionId: string;
  runId: string;
  runMode: AgentMode | string;
  workspaceRoot: string;
  userInputText: string | undefined;
  machine: RunStateMachine;
};

/**
 * AGT-03: modo Agent — edição multiarquivo, teste autorizado (shell) e diff agrupado
 * quando o UserInput traz um agentLoop scriptado (bootstrap até streaming real em task futura).
 */
export function runAgentModeIfRequested(input: AgentModeRunInput): AgentRunLoopResult | null {
  if (input.runMode !== "agent") {
    return null;
  }
  const plan = tryExtractAgentLoopPlanFromUserText(input.userInputText);
  if (!plan) {
    return null;
  }
  return executeAgentRunLoop({
    context: input.context,
    db: input.db,
    sessionId: input.sessionId,
    runId: input.runId,
    agentMode: "agent",
    workspaceRoot: input.workspaceRoot,
    plan,
    machine: input.machine,
  });
}
