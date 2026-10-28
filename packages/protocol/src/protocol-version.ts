import { PROTOCOL_ERROR_CODES } from "./errors.js";

/** Versão do protocolo wire RPC/eventos entre editor, CLI e daemon (ADR-003). */
export const OPENAGENT_DAEMON_PROTOCOL_VERSION = 1 as const;

export interface ProtocolVersionHello {
  type: "protocol.version";
  protocolVersion: typeof OPENAGENT_DAEMON_PROTOCOL_VERSION;
  clientId?: string;
}

export interface ProtocolVersionAck {
  type: "protocol.version.ack";
  protocolVersion: typeof OPENAGENT_DAEMON_PROTOCOL_VERSION;
}

export type ProtocolVersionValidationResult =
  | { valid: true; value: ProtocolVersionHello }
  | { valid: false; code: "INVALID_STATE"; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateProtocolVersionHello(raw: unknown): ProtocolVersionValidationResult {
  if (!isRecord(raw) || raw["type"] !== "protocol.version") {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["Handshake de versão deve ser um objeto protocol.version."],
    };
  }

  const errors: string[] = [];
  const version = raw["protocolVersion"];

  if (typeof version !== "number" || !Number.isInteger(version)) {
    errors.push("Campo obrigatório 'protocolVersion' deve ser um inteiro.");
  } else if (version !== OPENAGENT_DAEMON_PROTOCOL_VERSION) {
    errors.push(
      `Cliente incompatível: protocolVersion ${version} não é suportado (esperado ${OPENAGENT_DAEMON_PROTOCOL_VERSION}).`,
    );
  }

  if (raw["clientId"] !== undefined && !isNonEmptyString(raw["clientId"])) {
    errors.push("Campo opcional 'clientId' deve ser string não vazia quando presente.");
  }

  if (errors.length > 0) {
    return { valid: false, code: PROTOCOL_ERROR_CODES.INVALID_STATE, errors };
  }

  const hello: ProtocolVersionHello = {
    type: "protocol.version",
    protocolVersion: OPENAGENT_DAEMON_PROTOCOL_VERSION,
  };
  if (raw["clientId"] !== undefined) {
    hello.clientId = raw["clientId"] as string;
  }

  return { valid: true, value: hello };
}

export function buildProtocolVersionAck(
  hello: ProtocolVersionHello,
): ProtocolVersionAck {
  return {
    type: "protocol.version.ack",
    protocolVersion: hello.protocolVersion,
  };
}
