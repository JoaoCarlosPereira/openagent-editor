import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isHarnessDaemonTransportReady,
  reconcileOrphanHarnessDaemon,
} from "./daemon-health.js";
import {
  resolveHarnessDataRoot,
  resolveHarnessDaemonAddress,
  resolveHarnessRuntimeDirectory,
} from "./runtime-paths.js";
import { isUserDaemonLockHeld } from "./user-lock.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export type EnsureHarnessDaemonOptions = {
  dataRoot?: string;
  runtimeDirectory?: string;
  instanceId?: string;
  connectTimeoutMs?: number;
  spawnDaemon?: boolean;
  daemonEntry?: string;
};

async function waitForDaemon(
  address: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHarnessDaemonTransportReady(address)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new Error(`Timeout aguardando harness-daemon em ${address}`);
}

function defaultDaemonEntryPath(): string {
  return fileURLToPath(new URL("./daemon-entry.ts", import.meta.url));
}

function resolveMonorepoRootFromEntry(daemonEntry: string): string {
  return path.resolve(path.dirname(daemonEntry), "../../..");
}

function spawnHarnessDaemonProcess(options: {
  dataRoot: string;
  runtimeDirectory: string;
  daemonEntry: string;
}): void {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      options.daemonEntry,
      "--data-root",
      options.dataRoot,
      "--runtime-dir",
      options.runtimeDirectory,
    ],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
      cwd: resolveMonorepoRootFromEntry(options.daemonEntry),
    },
  );
  child.unref();
}

/**
 * Garante daemon local ouvindo — inicia sob demanda quando necessário (ADR-003).
 */
export async function ensureHarnessDaemonReady(
  options: EnsureHarnessDaemonOptions = {},
): Promise<{ address: string; dataRoot: string; runtimeDirectory: string }> {
  const dataRoot = resolveHarnessDataRoot(options.dataRoot);
  const runtimeDirectory =
    options.runtimeDirectory ?? resolveHarnessRuntimeDirectory(dataRoot);
  const address = resolveHarnessDaemonAddress(runtimeDirectory, options.instanceId);
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  await reconcileOrphanHarnessDaemon({ runtimeDirectory, instanceId: options.instanceId });

  if (await isHarnessDaemonTransportReady(address)) {
    return { address, dataRoot, runtimeDirectory };
  }

  if (isUserDaemonLockHeld(runtimeDirectory)) {
    if (!(await isHarnessDaemonTransportReady(address))) {
      await reconcileOrphanHarnessDaemon({
        runtimeDirectory,
        instanceId: options.instanceId,
      });
    }
    if (await isHarnessDaemonTransportReady(address)) {
      return { address, dataRoot, runtimeDirectory };
    }
    await waitForDaemon(address, timeoutMs);
    return { address, dataRoot, runtimeDirectory };
  }

  const shouldSpawn = options.spawnDaemon ?? true;
  if (!shouldSpawn) {
    await waitForDaemon(address, timeoutMs);
    return { address, dataRoot, runtimeDirectory };
  }

  const daemonEntry = options.daemonEntry ?? defaultDaemonEntryPath();
  spawnHarnessDaemonProcess({ dataRoot, runtimeDirectory, daemonEntry });
  await waitForDaemon(address, timeoutMs);
  return { address, dataRoot, runtimeDirectory };
}
