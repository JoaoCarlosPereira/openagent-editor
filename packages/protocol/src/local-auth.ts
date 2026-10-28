import { userInfo } from "node:os";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "./errors.js";

export const LOCAL_USER_ONLY_MESSAGE =
  "Acesso negado: o daemon local aceita apenas o usuário desta máquina.";

export type LocalPeerCredential =
  | { platform: "posix"; uid: number; gid: number }
  | { platform: "win32"; userSid: string };

export interface LocalDaemonPrincipal {
  username: string;
  platform: NodeJS.Platform;
  uid?: number;
  gid?: number;
  userSid?: string;
}

export type LocalAuthValidationResult =
  | { valid: true; principal: LocalDaemonPrincipal; workspaceId: string }
  | {
      valid: false;
      code: "INVALID_STATE" | "PERMISSION_DENIED";
      errors: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePeerCredential(raw: unknown): LocalPeerCredential | null {
  if (!isRecord(raw)) {
    return null;
  }
  const platform = raw["platform"];
  if (platform === "posix") {
    const uid = raw["uid"];
    const gid = raw["gid"];
    if (typeof uid !== "number" || typeof gid !== "number") {
      return null;
    }
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) {
      return null;
    }
    return { platform: "posix", uid, gid };
  }
  if (platform === "win32") {
    const userSid = raw["userSid"];
    if (typeof userSid !== "string" || userSid.trim().length === 0) {
      return null;
    }
    return { platform: "win32", userSid: userSid.trim() };
  }
  return null;
}

/**
 * Identidade do usuário local autorizado a falar com o daemon (socket/pipe autenticado).
 */
export function resolveLocalDaemonPrincipal(): LocalDaemonPrincipal {
  const info = userInfo();
  if (process.platform === "win32") {
    const sid = process.env["OPENAGENT_LOCAL_USER_SID"];
    return {
      username: info.username,
      platform: "win32",
      userSid: sid?.trim() || undefined,
    };
  }
  return {
    username: info.username,
    platform: process.platform,
    uid: info.uid,
    gid: info.gid,
  };
}

/**
 * Credencial do peer equivalente ao processo atual (cliente CLI/editor na mesma máquina).
 */
export function peerCredentialFromProcess(): LocalPeerCredential {
  if (process.platform === "win32") {
    const sid = process.env["OPENAGENT_LOCAL_USER_SID"]?.trim();
    if (!sid) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Credencial win32 indisponível: defina OPENAGENT_LOCAL_USER_SID ou use o transporte autenticado.",
      );
    }
    return { platform: "win32", userSid: sid };
  }
  const getuid = process.getuid;
  const getgid = process.getgid;
  if (getuid === undefined || getgid === undefined) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Credencial posix indisponível neste ambiente.",
    );
  }
  return {
    platform: "posix",
    uid: getuid(),
    gid: getgid(),
  };
}

function peerMatchesPrincipal(
  peer: LocalPeerCredential,
  principal: LocalDaemonPrincipal,
): boolean {
  if (peer.platform === "posix") {
    return (
      principal.platform !== "win32" &&
      principal.uid !== undefined &&
      peer.uid === principal.uid
    );
  }
  return (
    principal.platform === "win32" &&
    principal.userSid !== undefined &&
    peer.userSid === principal.userSid
  );
}

/**
 * Autentica o peer antes de expor estado do workspace (provedor, sessões, MCP) ao cliente CLI.
 */
export function validateLocalPeerAuth(
  peer: unknown,
  workspaceId: unknown,
): LocalAuthValidationResult {
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["workspaceId deve ser string não-vazia."],
    };
  }

  const parsedPeer = parsePeerCredential(peer);
  if (!parsedPeer) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["Credencial do peer inválida ou ausente."],
    };
  }

  const principal = resolveLocalDaemonPrincipal();

  if (parsedPeer.platform === "win32" && principal.userSid === undefined) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: [
        "Principal win32 sem userSid: configure OPENAGENT_LOCAL_USER_SID no daemon.",
      ],
    };
  }

  if (!peerMatchesPrincipal(parsedPeer, principal)) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.PERMISSION_DENIED,
      errors: [LOCAL_USER_ONLY_MESSAGE],
    };
  }

  return {
    valid: true,
    principal,
    workspaceId: workspaceId.trim(),
  };
}

export function assertLocalPeerAuth(
  peer: unknown,
  workspaceId: unknown,
): { principal: LocalDaemonPrincipal; workspaceId: string } {
  const result = validateLocalPeerAuth(peer, workspaceId);
  if (!result.valid) {
    throw new ProtocolError(
      result.code,
      result.errors[0] ?? "Autenticação local negada.",
      result.errors,
    );
  }
  return { principal: result.principal, workspaceId: result.workspaceId };
}
