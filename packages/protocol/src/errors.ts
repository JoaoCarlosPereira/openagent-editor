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

export type ProtocolErrorCode =
  | (typeof PROTOCOL_ERROR_CODES)[keyof typeof PROTOCOL_ERROR_CODES]
  | `PROVIDER_${string}`;

export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly details: string[];

  constructor(code: ProtocolErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
