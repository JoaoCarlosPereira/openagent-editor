/**
 * Códigos de erro estáveis conforme seção "Interfaces Principais" da TechSpec.
 */
export const PROTOCOL_ERROR_CODES = {
  INVALID_STATE: "INVALID_STATE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  OUT_OF_SCOPE: "OUT_OF_SCOPE",
  CONFLICT: "CONFLICT",
  CANCELLED: "CANCELLED",
  INCOMPLETE_STREAM: "INCOMPLETE_STREAM",
} as const;

export type BaseProtocolErrorCode =
  (typeof PROTOCOL_ERROR_CODES)[keyof typeof PROTOCOL_ERROR_CODES];

export type ProtocolErrorCode = BaseProtocolErrorCode | `PROVIDER_${string}`;

export type TerminalRunState = "completed" | "cancelled";

export type ProviderFailureReason =
  | "timeout"
  | "rate_limit"
  | "capability_missing";

export interface ProtocolErrorHints {
  runState?: TerminalRunState;
  requiresNewUserMessage?: boolean;
  requestedPath?: string;
  idempotentRetry?: boolean;
  skipRepeatedMutations?: boolean;
  preservePrompt?: boolean;
  preserveDiff?: boolean;
  providerCause?: string;
}

const PROVIDER_FAILURE_CODES: Record<ProviderFailureReason, `PROVIDER_${string}`> = {
  timeout: "PROVIDER_TIMEOUT",
  rate_limit: "PROVIDER_RATE_LIMIT",
  capability_missing: "PROVIDER_CAPABILITY_MISSING",
};

export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly details: string[];
  public readonly hints?: ProtocolErrorHints;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    details: string[] = [],
    hints?: ProtocolErrorHints,
  ) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
    this.hints = hints;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isProtocolError(value: unknown): value is ProtocolError {
  return value instanceof ProtocolError;
}

export function isProviderErrorCode(code: string): code is `PROVIDER_${string}` {
  return code.startsWith("PROVIDER_") && code.length > "PROVIDER_".length;
}

export function isStableProtocolErrorCode(code: unknown): code is ProtocolErrorCode {
  if (typeof code !== "string") {
    return false;
  }
  if (isProviderErrorCode(code)) {
    return true;
  }
  return (Object.values(PROTOCOL_ERROR_CODES) as string[]).includes(code);
}

export function refuseToolInTerminalRunError(
  runState: TerminalRunState,
): ProtocolError {
  const label = runState === "completed" ? "concluída" : "cancelada";
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.INVALID_STATE,
    `Execução ${label}: nova ferramenta só é permitida após uma mensagem nova do usuário.`,
    [],
    { runState, requiresNewUserMessage: true },
  );
}

export function outOfScopePathError(requestedPath: string): ProtocolError {
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.OUT_OF_SCOPE,
    "Caminho fora do escopo.",
    ["Caminho fora do escopo."],
    { requestedPath },
  );
}

export function incompleteStreamError(): ProtocolError {
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
    "Resposta incompleta: a conexão de streaming foi interrompida.",
    [],
    { idempotentRetry: true, skipRepeatedMutations: true },
  );
}

export function providerFailureError(
  reason: ProviderFailureReason,
  providerCause: string,
): ProtocolError {
  const code = PROVIDER_FAILURE_CODES[reason];
  return new ProtocolError(
    code,
    providerCause,
    [providerCause],
    {
      providerCause,
      preservePrompt: true,
      preserveDiff: true,
    },
  );
}

export function permissionDeniedError(
  message: string,
  details: string[] = [],
): ProtocolError {
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.PERMISSION_DENIED,
    message,
    details,
  );
}

export function conflictError(
  message: string,
  details: string[] = [],
): ProtocolError {
  return new ProtocolError(
    PROTOCOL_ERROR_CODES.CONFLICT,
    message,
    details,
  );
}

export function cancelledError(message = "Operação cancelada."): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.CANCELLED, message);
}
