/** Reexport AGT-02 Plan UI (controller vive em review; card lista permissions/). */
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
} from "../review/plan-progress.js";
