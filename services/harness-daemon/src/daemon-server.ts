import type net from "node:net";
import { listenLocalTransport, type LocalTransportServer } from "@openagent/protocol";
import { performServerTransportHandshake } from "./transport-handshake.js";
import { WorkspaceStateRegistry } from "./workspace-state.js";
import { resolveHarnessDaemonAddress } from "./runtime-paths.js";

export type HarnessDaemonServer = {
  address: string;
  close(): Promise<void>;
};

export type StartHarnessDaemonServerOptions = {
  runtimeDirectory: string;
  dataRoot: string;
  instanceId?: string;
  drainTimeoutMs?: number;
};

const DEFAULT_DRAIN_TIMEOUT_MS = 2_000;

export async function startHarnessDaemonServer(
  options: StartHarnessDaemonServerOptions,
): Promise<HarnessDaemonServer> {
  const address = resolveHarnessDaemonAddress(options.runtimeDirectory, options.instanceId);
  const registry = new WorkspaceStateRegistry({
    dataRoot: options.dataRoot,
    runtimeDirectory: options.runtimeDirectory,
  });
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;

  let acceptingConnections = true;
  const connectionSet = new Set<net.Socket>();

  const server: LocalTransportServer = await listenLocalTransport(
    address,
    async (socket: net.Socket) => {
      if (!acceptingConnections) {
        socket.destroy();
        return;
      }
      connectionSet.add(socket);
      socket.once("close", () => {
        connectionSet.delete(socket);
      });

      try {
        await performServerTransportHandshake(
          socket,
          (hello) => registry.upsertFromHello(hello),
          { dataRoot: options.dataRoot },
        );
      } catch {
        socket.destroy();
      }
    },
  );

  return {
    address: server.address,
    close: async () => {
      acceptingConnections = false;
      await waitForActiveConnections(connectionSet, drainTimeoutMs);
      for (const socket of connectionSet) {
        socket.destroy();
      }
      await server.close();
    },
  };
}

async function waitForActiveConnections(
  sockets: Set<net.Socket>,
  timeoutMs: number,
): Promise<void> {
  if (sockets.size === 0) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && sockets.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
