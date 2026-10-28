export {
  buildTargetPattern,
  computeGrantExpiresAtMs,
  consumeOnceGrant,
  grantMatchesRequest,
  InMemoryGrantRegistry,
  isGrantExpired,
  issuePermissionGrant,
  issuePermissionGrantFromGate,
  validatePermissionGrantContext,
  type IssuePermissionGrantInput,
  type PermissionGrant,
  type PermissionGrantContext,
} from "./grants.js";
export {
  describeCapabilityAction,
  validatePolicyCapability,
} from "./capability.js";
export {
  AGENT_MODE_ASK_BLOCKED_MESSAGE,
  assertCapabilityAllowedForAgentMode,
  askAgentModeBlockedError,
  POLICY_AGENT_MODES,
  validatePolicyAgentMode,
} from "./agent-mode.js";
export {
  assertCapabilityAllowedForExecutionMode,
  EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  EXECUTION_MODES,
  isMutatingPolicyCapability,
  readOnlyExecutionModeBlockedError,
  validateExecutionMode,
  type ExecutionMode,
} from "./execution-mode.js";
export {
  buildPermissionPrompt,
  createToolPermissionRequest,
  formatPermissionPromptForDisplay,
  mayExecuteAfterPermissionGate,
  openPermissionExecutionGate,
  resolvePermissionExecutionGate,
  validateToolPermissionRequest,
  type CreateToolPermissionRequestInput,
} from "./permission-model.js";
export {
  RUN_PERMISSION_DECIDED_EVENT,
  RUN_PERMISSION_REQUESTED_EVENT,
  RunToolPermissionFlow,
  assertRunToolMayExecute,
  buildPermissionDecidedPayload,
  buildPermissionRequestedPayload,
  persistHarnessEventWithPayload,
  persistPermissionDecidedEvent,
  persistPermissionRequestedEvent,
  prepareRunToolPermission,
  resolveRunToolPermission,
  validateBeginRunToolPermissionInput,
  type BeginRunToolPermissionInput,
  type PermissionDecidedPayload,
  type PermissionRequestedPayload,
  type RunPermissionEventWriter,
  type RunToolPermissionPrepareResult,
  type ToolExecutionIsolationContext,
} from "./run-permission.js";
export {
  formatGrantScopeLabel,
  GRANT_SCOPE_KINDS,
  validateGrantScope,
  validateOfferedScopes,
} from "./scope.js";
export { formatPolicyTargetDisplay, validatePolicyTarget } from "./target.js";
export {
  formatOutOfScopePathLog,
  isAbsolutePathInsideRoot,
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
  validateWorkspacePathInputs,
  type WorkspacePathResolution,
} from "./paths.js";
export {
  assertValidStandardLogToolAction,
  formatStandardLogToolAction,
  redactForStandardLog,
  STANDARD_LOG_REDACTED,
  validateStandardLogToolActionInput,
  type StandardLogToolActionInput,
} from "./redaction.js";
export {
  createLocalStructuredLogger,
  STRUCTURED_LOG_LEVELS,
  validateStructuredLogWriteInput,
  type LocalStructuredLogContext,
  type LocalStructuredLogger,
  type StructuredLogLevel,
  type StructuredLogSink,
  type StructuredLogWriteInput,
} from "./logger.js";
export {
  DEFAULT_LOCAL_HOOK_HANDLER_TIMEOUT_MS,
  LocalHookEngine,
  assertLocalHooksAllowAction,
  hookActionDeniedError,
  validateLocalHookAction,
} from "./hooks/engine.js";
export type { LocalHookEngineOptions } from "./hooks/engine.js";
export { formatHookDenialForDisplay } from "./hooks/display.js";
export type {
  HookDenialDisplay,
  LocalHookAction,
  LocalHookDecision,
  LocalHookEvaluationResult,
  LocalHookHandler,
  LocalHookHandlerOutcome,
  RegisteredLocalHook,
} from "./hooks/types.js";
export type {
  GrantScopeKind,
  PermissionDecision,
  PermissionExecutionGate,
  PermissionPrompt,
  SandboxIsolationLevel,
  PolicyCapability,
  PolicyTarget,
  PolicyTargetKind,
  PolicyValidationResult,
  ToolPermissionRequest,
} from "./types.js";
