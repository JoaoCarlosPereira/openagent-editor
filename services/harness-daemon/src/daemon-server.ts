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
};

export async function startHarnessDaemonServer(
  options: StartHarnessDaemonServerOptions,
): Promise<HarnessDaemonServer> {
  const address = resolveHarnessDaemonAddress(options.runtimeDirectory, options.instanceId);
  const registry = new WorkspaceStateRegistry(options.dataRoot);

  const server: LocalTransportServer = await listenLocalTransport(
    address,
    async (socket: net.Socket) => {
      try {
        await performServerTransportHandshake(socket, (hello) =>
          registry.upsertFromHello(hello),
        );
      } catch {
        socket.destroy();
      }
    },
  );

  return {
    address: server.address,
    close: () => server.close(),
  };
}
