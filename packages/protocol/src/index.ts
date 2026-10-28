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
