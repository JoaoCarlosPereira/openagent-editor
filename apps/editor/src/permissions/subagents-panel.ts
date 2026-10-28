/** Reexport AGT-05/AGT-07 subagentes UI (controller vive em review; card lista permissions/). */
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
} from "../review/subagents-panel.js";
