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
  CheckpointRestoreController,
  CHECKPOINT_RESTORE_IDLE_MESSAGE,
  CHECKPOINT_RESTORE_OK_MESSAGE,
  CHECKPOINT_RESTORE_CONFLICT_MESSAGE,
  buildCheckpointRestoreView,
  type AcceptRestoreOutcomeInput,
  type CheckpointRestoreConflictEntry,
  type CheckpointRestorePhase,
  type CheckpointRestoreRequest,
  type CheckpointRestoreViewSnapshot,
} from "./checkpoint-restore.js";

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
  SubagentsPanelController,
  AGENT_SPAWNED_EVENT,
  AGENT_COMPLETED_EVENT,
  AGENT_CANCELLED_EVENT,
  buildSubagentsPanelView,
  type AgentSpawnedPayload,
  type AgentCompletedPayload,
  type AgentCancelledPayload,
  type SubagentCancelResult,
  type SubagentRow,
  type SubagentUiState,
  type SubagentsPanelPushInput,
  type SubagentsPanelViewSnapshot,
} from "./subagents-panel.js";

export {
  ReadOnlyExecutionBlockController,
  evaluateReadOnlyExecutionBlock,
  type ReadOnlyBlockAttemptResult,
  type ReadOnlyBlockViewSnapshot,
} from "../permissions/read-only-block.js";

export {
  ProviderRunErrorController,
  PROVIDER_RUN_ERROR_IDLE_MESSAGE,
  PROVIDER_RUN_ERROR_FAILURE_MESSAGE,
  PROVIDER_RUN_ERROR_INCOMPLETE_MESSAGE,
  buildProviderRunErrorView,
  type ProviderRunErrorPhase,
  type ProviderRunErrorViewSnapshot,
  type ProviderRunResponseStatus,
  type ProviderRunRetryRequest,
} from "./provider-run-error.js";

export {
  CustomizationOriginController,
  CUSTOMIZATION_ORIGIN_IDLE_MESSAGE,
  CUSTOMIZATION_ORIGIN_RULES_MESSAGE,
  CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE,
  CUSTOMIZATION_ORIGIN_HOOK_DENIED_MESSAGE,
  buildCustomizationOriginView,
  type AcceptSessionRulesInput,
  type AcceptCustomizationInvokeInput,
  type AttemptHookGuardedActionResult,
  type CustomizationOriginPhase,
  type CustomizationOriginViewSnapshot,
} from "../permissions/customization-origin.js";
