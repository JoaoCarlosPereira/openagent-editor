/** Revisão/diff do agente (AGT-03+) e reexportes de permissões na UI. */
export const REVIEW_MODULE_ID = "openagent.editor.review";

export {
  AgentRunReviewController,
  buildAgentRunReviewView,
  type AgentRunReviewPushInput,
  type AgentRunReviewViewSnapshot,
  type AgentToolResultRow,
  type DiffGroupedEventPayload,
  type ToolResultEventPayload,
} from "./agent-run-review.js";

export {
  ReadOnlyExecutionBlockController,
  evaluateReadOnlyExecutionBlock,
  type ReadOnlyBlockAttemptResult,
  type ReadOnlyBlockViewSnapshot,
} from "../permissions/read-only-block.js";
