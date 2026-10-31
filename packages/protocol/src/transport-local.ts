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

interface FrameReader {
  frames: Buffer[];
  waiters: Array<{ resolve: (frame: Buffer) => void; reject: (error: Error) => void }>;
  error?: Error;
}

const readers = new WeakMap<net.Socket, FrameReader>();

export function readProtocolFrame(socket: net.Socket): Promise<Buffer> {
  let reader = readers.get(socket);
  if (!reader) {
    reader = { frames: [], waiters: [] };
    readers.set(socket, reader);
    const state = reader;
    const decoder = new ProtocolFrameDecoder();
    const fail = (error: Error) => {
      if (state.error) return;
      state.error = error;
      for (const waiter of state.waiters.splice(0)) waiter.reject(error);
    };
    socket.on("data", (chunk: Buffer) => {
      try {
        decoder.push(chunk);
        for (const frame of decoder.drain()) {
          const waiter = state.waiters.shift();
          if (waiter) waiter.resolve(frame);
          else state.frames.push(frame);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", fail);
    socket.on("close", () => {
      fail(
        new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Conexão encerrada antes de receber um frame completo.",
        ),
      );
    });
  }
  const frame = reader.frames.shift();
  if (frame !== undefined) return Promise.resolve(frame);
  if (reader.error) return Promise.reject(reader.error);
  return new Promise((resolve, reject) => {
    reader.waiters.push({ resolve, reject });
  });
}
