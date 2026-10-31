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
  validateWorkspaceTransportHello,
  type ProtocolTransportErrorFrame,
  type WorkspaceTransportAck,
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
  OPENAGENT_DAEMON_PROTOCOL_VERSION,
  buildProtocolVersionAck,
  validateProtocolVersionHello,
  type ProtocolVersionAck,
  type ProtocolVersionHello,
  type ProtocolVersionValidationResult,
} from "./protocol-version.js";
