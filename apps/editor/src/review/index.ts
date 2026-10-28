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
  ApplyConflictController,
  APPLY_CONFLICT_DEFAULT_MESSAGE,
  buildApplyConflictView,
  parseApplyConflictFromProtocolError,
  type ApplyConflictEntry,
  type ApplyConflictViewSnapshot,
} from "./apply-conflict.js";

export {
  ReadOnlyExecutionBlockController,
  evaluateReadOnlyExecutionBlock,
  type ReadOnlyBlockAttemptResult,
  type ReadOnlyBlockViewSnapshot,
} from "../permissions/read-only-block.js";
