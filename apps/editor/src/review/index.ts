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
  PlanProgressController,
  PLAN_ACCEPTED_EVENT,
  PLAN_PRESENTED_EVENT,
  PLAN_PROGRESS_EVENT,
  buildPlanProgressView,
  type PlanAcceptedPayload,
  type PlanPresentedPayload,
  type PlanProgressPayload,
  type PlanProgressPhase,
  type PlanProgressPushInput,
  type PlanProgressStep,
  type PlanProgressViewSnapshot,
} from "./plan-progress.js";

export {
  DebugEvidenceController,
  DEBUG_EVIDENCE_EVENT,
  DEBUG_HYPOTHESIS_EVENT,
  DEBUG_VERIFICATION_EVENT,
  buildDebugEvidenceView,
  type DebugEvidencePayload,
  type DebugEvidencePhase,
  type DebugEvidencePushInput,
  type DebugEvidenceViewSnapshot,
  type DebugHypothesisPayload,
  type DebugVerificationOutcome,
  type DebugVerificationPayload,
} from "./debug-evidence.js";

export {
  ReadOnlyExecutionBlockController,
  evaluateReadOnlyExecutionBlock,
  type ReadOnlyBlockAttemptResult,
  type ReadOnlyBlockViewSnapshot,
} from "../permissions/read-only-block.js";
