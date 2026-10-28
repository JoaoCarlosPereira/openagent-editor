/** Reexport da UI CUS-01/02/03 (arquivos relevantes incluem apps/editor/src/review/). */
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
