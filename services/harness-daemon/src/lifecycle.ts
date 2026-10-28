import type { UserDaemonLock } from "./user-lock.js";
import { acquireUserDaemonLock } from "./user-lock.js";
import {
  resolveHarnessDataRoot,
  resolveHarnessRuntimeDirectory,
} from "./runtime-paths.js";
import {
  startHarnessDaemonServer,
  type HarnessDaemonServer,
} from "./daemon-server.js";

export type HarnessDaemonRuntime = {
  address: string;
  dataRoot: string;
  runtimeDirectory: string;
  lock: UserDaemonLock;
  server: HarnessDaemonServer;
  stop(): Promise<void>;
};

export type StartHarnessDaemonOptions = {
  dataRoot?: string;
  runtimeDirectory?: string;
  instanceId?: string;
};

export async function startHarnessDaemon(
  options: StartHarnessDaemonOptions = {},
): Promise<HarnessDaemonRuntime> {
  const dataRoot = resolveHarnessDataRoot(options.dataRoot);
  const runtimeDirectory =
    options.runtimeDirectory ?? resolveHarnessRuntimeDirectory(dataRoot);
  const lock = acquireUserDaemonLock(runtimeDirectory);
  const server = await startHarnessDaemonServer({
    runtimeDirectory,
    dataRoot,
    instanceId: options.instanceId,
  });

  return {
    address: server.address,
    dataRoot,
    runtimeDirectory,
    lock,
    server,
    stop: async () => {
      await server.close();
      lock.release();
    },
  };
}
