export {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type ProtocolErrorCode,
} from "./errors.js";

export {
  type CommandEnvelope,
  type EnvelopeValidationResult,
  type MutableCommandEnvelope,
} from "./types.js";

export {
  assertCommandEnvelope,
  assertMutableCommandEnvelope,
  validateCommandEnvelope,
  validateMutableCommandEnvelope,
} from "./validator.js";

export {
  HARNESS_EVENT_SCHEMA_VERSION,
  assertHarnessEvent,
  validateHarnessEvent,
  validateHarnessEventStream,
  type HarnessEvent,
  type HarnessEventValidationResult,
} from "./harness-event.js";

export {
  USER_INPUT_EMPTY_MESSAGE,
  type UserContextAttachment,
  type UserInput,
  type UserInputValidationResult,
} from "./user-input.js";

export { assertUserInput, validateUserInput } from "./user-input-validator.js";

export {
  ALL_RPC_METHODS,
  RPC_METHOD,
  RPC_METHOD_SPECS,
  RPC_PROTOCOL_VERSION,
  getRpcMethodSpec,
  isRpcMethod,
  type AgentMode,
  type CheckpointCreateParams,
  type CheckpointRestoreParams,
  type ContextAttachParams,
  type ContextClearParams,
  type ContextIndexParams,
  type ContextSearchParams,
  type ExtensionDisableParams,
  type ExtensionEnableParams,
  type ExtensionInstallParams,
  type PermissionDecision,
  type PermissionDecideParams,
  type ProjectAcceptParams,
  type ProjectCreateParams,
  type ProjectRejectParams,
  type RpcMethod,
  type RpcMethodSpec,
  type RpcParamsMap,
  type RpcResultMap,
  type RunCancelParams,
  type RunQueueAddParams,
  type RunQueueRemoveParams,
  type RunResumeParams,
  type RunStartParams,
  type SessionCreateParams,
  type SessionExportParams,
  type SessionForkParams,
  type SessionListParams,
  type SessionSearchParams,
  type ToolInvokeParams,
  type WorkspaceBindingFacet,
} from "./rpc-methods.js";

export {
  assertRpcRequest,
  validateRpcRequest,
  type RpcRequestEnvelope,
  type RpcRequestValidationResult,
} from "./rpc-validator.js";
