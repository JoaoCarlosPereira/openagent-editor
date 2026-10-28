import type { ProtocolErrorCode } from "./errors.js";
import { PROTOCOL_ERROR_CODES } from "./errors.js";

/** Handshake inicial da CLI para reutilizar configuração do workspace (CLI-01). */
export interface WorkspaceTransportHello {
  type: "workspace.hello";
  workspaceId: string;
  workspaceRoot: string;
  providerProfileId: string;
  mode: string;
  rulesRef: string;
  mcpServerIds: string[];
  sessionIds: string[];
}

export interface WorkspaceTransportAck {
  type: "workspace.ack";
  workspaceId: string;
  providerProfileId: string;
  mode: string;
  rulesRef: string;
  mcpServerIds: string[];
  sessionIds: string[];
}

export interface ProtocolTransportErrorFrame {
  type: "protocol.error";
  code: ProtocolErrorCode;
  message: string;
}

export type WorkspaceTransportValidationResult =
  | { valid: true; value: WorkspaceTransportHello }
  | { valid: false; code: "INVALID_STATE"; errors: string[] };

export type WorkspaceTransportAckValidationResult =
  | { valid: true; value: WorkspaceTransportAck }
  | { valid: false; code: "INVALID_STATE"; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validateWorkspaceTransportHello(raw: unknown): WorkspaceTransportValidationResult {
  const errors: string[] = [];

  if (!isRecord(raw) || raw["type"] !== "workspace.hello") {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["Handshake deve ser um objeto workspace.hello."],
    };
  }

  if (!isNonEmptyString(raw["workspaceId"])) {
    errors.push("Campo obrigatório 'workspaceId' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["workspaceRoot"])) {
    errors.push("Campo obrigatório 'workspaceRoot' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["providerProfileId"])) {
    errors.push("Campo obrigatório 'providerProfileId' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["mode"])) {
    errors.push("Campo obrigatório 'mode' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["rulesRef"])) {
    errors.push("Campo obrigatório 'rulesRef' ausente ou inválido.");
  }
  if (!isStringArray(raw["mcpServerIds"])) {
    errors.push("Campo obrigatório 'mcpServerIds' deve ser um array de strings.");
  }
  if (!isStringArray(raw["sessionIds"])) {
    errors.push("Campo obrigatório 'sessionIds' deve ser um array de strings.");
  }

  if (errors.length > 0) {
    return { valid: false, code: PROTOCOL_ERROR_CODES.INVALID_STATE, errors };
  }

  return {
    valid: true,
    value: {
      type: "workspace.hello",
      workspaceId: raw["workspaceId"] as string,
      workspaceRoot: raw["workspaceRoot"] as string,
      providerProfileId: raw["providerProfileId"] as string,
      mode: raw["mode"] as string,
      rulesRef: raw["rulesRef"] as string,
      mcpServerIds: raw["mcpServerIds"] as string[],
      sessionIds: raw["sessionIds"] as string[],
    },
  };
}

export function validateWorkspaceTransportAck(raw: unknown): WorkspaceTransportAckValidationResult {
  const errors: string[] = [];

  if (!isRecord(raw) || raw["type"] !== "workspace.ack") {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["Resposta deve ser um objeto workspace.ack."],
    };
  }

  if (!isNonEmptyString(raw["workspaceId"])) {
    errors.push("Campo obrigatório 'workspaceId' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["providerProfileId"])) {
    errors.push("Campo obrigatório 'providerProfileId' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["mode"])) {
    errors.push("Campo obrigatório 'mode' ausente ou inválido.");
  }
  if (!isNonEmptyString(raw["rulesRef"])) {
    errors.push("Campo obrigatório 'rulesRef' ausente ou inválido.");
  }
  if (!isStringArray(raw["mcpServerIds"])) {
    errors.push("Campo obrigatório 'mcpServerIds' deve ser um array de strings.");
  }
  if (!isStringArray(raw["sessionIds"])) {
    errors.push("Campo obrigatório 'sessionIds' deve ser um array de strings.");
  }

  if (errors.length > 0) {
    return { valid: false, code: PROTOCOL_ERROR_CODES.INVALID_STATE, errors };
  }

  return {
    valid: true,
    value: {
      type: "workspace.ack",
      workspaceId: raw["workspaceId"] as string,
      providerProfileId: raw["providerProfileId"] as string,
      mode: raw["mode"] as string,
      rulesRef: raw["rulesRef"] as string,
      mcpServerIds: raw["mcpServerIds"] as string[],
      sessionIds: raw["sessionIds"] as string[],
    },
  };
}

export function buildWorkspaceTransportAck(
  hello: WorkspaceTransportHello,
): WorkspaceTransportAck {
  return {
    type: "workspace.ack",
    workspaceId: hello.workspaceId,
    providerProfileId: hello.providerProfileId,
    mode: hello.mode,
    rulesRef: hello.rulesRef,
    mcpServerIds: [...hello.mcpServerIds],
    sessionIds: [...hello.sessionIds],
  };
}

export function buildProtocolTransportErrorFrame(
  code: ProtocolErrorCode,
  message: string,
): ProtocolTransportErrorFrame {
  return { type: "protocol.error", code, message };
}
