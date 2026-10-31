import fs from "node:fs";
import { connectLocalTransport } from "@openagent/protocol";
import {
  resolveHarnessDaemonAddress,
  resolveHarnessUserLockPath,
} from "./runtime-paths.js";
import {
  isHarnessDaemonProcessAlive,
  readUserDaemonLockRecord,
  removeUserDaemonLockFile,
} from "./user-lock.js";

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

export async function isHarnessDaemonTransportReady(address: string): Promise<boolean> {
  if (process.platform !== "win32" && fs.existsSync(address)) {
    return true;
  }
  try {
    const socket = await connectLocalTransport(address);
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

export type HarnessDaemonOrphanState = {
  orphaned: boolean;
  lockPid: number | null;
  transportReady: boolean;
};

export async function inspectHarnessDaemonOrphanState(options: {
  runtimeDirectory: string;
  instanceId?: string;
}): Promise<HarnessDaemonOrphanState> {
  const lockPath = resolveHarnessUserLockPath(options.runtimeDirectory);
  if (!fs.existsSync(lockPath)) {
    return { orphaned: false, lockPid: null, transportReady: false };
  }

  const record = readUserDaemonLockRecord(options.runtimeDirectory);
  const address = resolveHarnessDaemonAddress(options.runtimeDirectory, options.instanceId);
  const transportReady = await isHarnessDaemonTransportReady(address);

  if (!record) {
    return { orphaned: true, lockPid: null, transportReady };
  }

  const pidAlive = isHarnessDaemonProcessAlive(record.pid);
  if (!pidAlive) {
    return { orphaned: true, lockPid: record.pid, transportReady };
  }

  if (!transportReady) {
    return { orphaned: true, lockPid: record.pid, transportReady };
  }

  return { orphaned: false, lockPid: record.pid, transportReady };
}

export async function reconcileOrphanHarnessDaemon(options: {
  runtimeDirectory: string;
  instanceId?: string;
}): Promise<boolean> {
  const state = await inspectHarnessDaemonOrphanState(options);
  if (!state.orphaned) {
    return false;
  }

  const address = resolveHarnessDaemonAddress(options.runtimeDirectory, options.instanceId);
  unlinkSocketIfExists(address);

  if (state.lockPid !== null && isHarnessDaemonProcessAlive(state.lockPid)) {
    try {
      process.kill(state.lockPid, "SIGTERM");
    } catch {
      // Processo encerrou entre a inspeção e o sinal.
    }
  }

  removeUserDaemonLockFile(options.runtimeDirectory);
  return true;
}
