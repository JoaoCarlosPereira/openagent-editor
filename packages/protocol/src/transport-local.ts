import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "./errors.js";
import {
  ProtocolFrameDecoder,
  encodeProtocolFrame,
} from "./transport-framing.js";

export interface LocalTransportServer {
  address: string;
  close(): Promise<void>;
}

function unlinkSocketIfExists(socketPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Endereço do daemon: named pipe no Windows, socket Unix nos demais SOs (ADR-003).
 */
export function resolveLocalTransportAddress(
  runtimeDirectory: string,
  instanceId = "default",
): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\openagent-harness-${instanceId}`;
  }
  return path.join(runtimeDirectory, `openagent-harness-${instanceId}.sock`);
}

export function connectLocalTransport(address: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(address);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function listenLocalTransport(
  address: string,
  onConnection: (socket: net.Socket) => void | Promise<void>,
): Promise<LocalTransportServer> {
  if (process.platform !== "win32") {
    fs.mkdirSync(path.dirname(address), { recursive: true });
    unlinkSocketIfExists(address);
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      void Promise.resolve(onConnection(socket)).catch((error: unknown) => {
        socket.destroy(error instanceof Error ? error : undefined);
      });
    });

    server.once("error", reject);
    server.listen(address, () => {
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(address, 0o600);
        } catch {
          // Permissões do socket são best-effort no ambiente de teste.
        }
      }
      resolve({
        address,
        close: async () => {
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          });
          if (process.platform !== "win32") {
            unlinkSocketIfExists(address);
          }
        },
      });
    });
  });
}

export function writeProtocolFrame(socket: net.Socket, body: Uint8Array): void {
  socket.write(encodeProtocolFrame(body));
}

export function readProtocolFrame(socket: net.Socket): Promise<Buffer> {
  const decoder = new ProtocolFrameDecoder();

  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      try {
        decoder.push(chunk);
        const frames = decoder.drain();
        const firstFrame = frames[0];
        if (firstFrame !== undefined) {
          cleanup();
          resolve(firstFrame);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      reject(
        new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Conexão encerrada antes de receber um frame completo.",
        ),
      );
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}
