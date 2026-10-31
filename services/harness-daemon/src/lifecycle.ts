import type { CompletionTextSource } from "./completion/completion-source.js";
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
  drainTimeoutMs?: number;
  /** Fonte de texto do completion (TAB-01); testes injetam uma fonte controlada. */
  completionSource?: CompletionTextSource;
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
    drainTimeoutMs: options.drainTimeoutMs,
    completionSource: options.completionSource,
  });

  let stopped = false;
  return {
    address: server.address,
    dataRoot,
    runtimeDirectory,
    lock,
    server,
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      await server.close();
      lock.release();
    },
  };
}
