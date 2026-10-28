import type net from "node:net";
import {
  peerCredentialFromProcess,
  type LocalPeerCredential,
} from "@openagent/protocol";

type SocketHandle = {
  getpeeruid?: () => number;
  getpeergid?: () => number;
};

/**
 * Credencial do peer conectado ao socket/pipe local (SO_PEERCRED quando disponível).
 */
export function readPeerCredentialFromSocket(socket: net.Socket): LocalPeerCredential {
  if (process.platform === "win32") {
    return peerCredentialFromProcess();
  }

  const handle = (socket as unknown as { _handle?: SocketHandle })._handle;
  const uid = handle?.getpeeruid?.();
  const gid = handle?.getpeergid?.();
  if (typeof uid === "number" && typeof gid === "number") {
    return { platform: "posix", uid, gid };
  }

  return peerCredentialFromProcess();
}
