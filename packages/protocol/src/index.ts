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
  LOCAL_USER_ONLY_MESSAGE,
  assertLocalPeerAuth,
  peerCredentialFromProcess,
  resolveLocalDaemonPrincipal,
  validateLocalPeerAuth,
  type LocalAuthValidationResult,
  type LocalDaemonPrincipal,
  type LocalPeerCredential,
} from "./local-auth.js";
