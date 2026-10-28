export {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  cancelledError,
  conflictError,
  incompleteStreamError,
  isProtocolError,
  isProviderErrorCode,
  isStableProtocolErrorCode,
  outOfScopePathError,
  permissionDeniedError,
  providerFailureError,
  refuseToolInTerminalRunError,
  type BaseProtocolErrorCode,
  type ProtocolErrorCode,
  type ProtocolErrorHints,
  type ProviderFailureReason,
  type TerminalRunState,
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
  type CheckpointRestoreConflictEntry,
  type CheckpointRestoreParams,
  type CheckpointRestoreRpcResult,
  type ContextAttachParams,
  type ContextAttachResult,
  type ContextAttachSource,
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
  type SessionListItem,
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

export {
  PROTOCOL_FRAME_LENGTH_BYTES,
  PROTOCOL_MAX_FRAME_BYTES,
  ProtocolFrameDecoder,
  encodeProtocolFrame,
} from "./transport-framing.js";

export {
  connectLocalTransport,
  listenLocalTransport,
  readProtocolFrame,
  resolveLocalTransportAddress,
  writeProtocolFrame,
  type LocalTransportServer,
} from "./transport-local.js";

export {
  buildProtocolTransportErrorFrame,
  buildWorkspaceTransportAck,
  validateWorkspaceTransportAck,
  validateWorkspaceTransportHello,
  type ProtocolTransportErrorFrame,
  type WorkspaceTransportAck,
  type WorkspaceTransportAckValidationResult,
  type WorkspaceTransportHello,
  type WorkspaceTransportValidationResult,
} from "./workspace-transport.js";

export {
  LOCAL_USER_ONLY_MESSAGE,
  assertLocalPeerAuth,
  peerCredentialFromProcess,
  resolveLocalDaemonPrincipal,
  validateLocalPeerAuth,
  type LocalAuthValidationResult,
  type LocalDaemonPrincipal,
  type LocalPeerCredential,
} from "./local-auth.js";

export {
  DEFAULT_HARNESS_EVENT_STREAM_BUFFER_SIZE,
  HarnessEventStreamController,
  restoreHarnessEventStreamFromSnapshot,
  type HarnessEventStreamOptions,
  type HarnessEventStreamPushResult,
  type HarnessEventStreamSnapshot,
} from "./event-stream.js";

export {
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  buildProtocolVersionAck,
  validateProtocolVersionHello,
  type ProtocolVersionAck,
  type ProtocolVersionHello,
  type ProtocolVersionValidationResult,
} from "./protocol-version.js";

export {
  buildHarnessRpcOkFrame,
  connectHarnessClient,
  type ConnectHarnessClientOptions,
  type CreateSession,
  type GrantDecision,
  type HarnessClient,
  type HarnessWorkspaceBinding,
  type QueueItem,
  type RestoreResult,
  type Session,
  type StartRun,
} from "./harness-client.js";
