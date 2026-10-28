import fs from "node:fs";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  resolveHarnessDaemonAddress,
  resolveHarnessRuntimeDirectory,
  resolveHarnessDataRoot,
  resolveHarnessUserLockPath,
} from "./runtime-paths.js";
import {
  isHarnessDaemonProcessAlive,
  readUserDaemonLockRecord,
  removeUserDaemonLockFile,
} from "./user-lock.js";

const DEFAULT_SIGNAL_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export type ShutdownHarnessDaemonSupervisedOptions = {
  dataRoot?: string;
  runtimeDirectory?: string;
  instanceId?: string;
  signalTimeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isHarnessDaemonProcessAlive(pid)) {
      return true;
    }
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }
  return !isHarnessDaemonProcessAlive(pid);
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
 * Encerra o harness-daemon registrado no lock com SIGTERM/SIGKILL supervisionados (ADR-003).
 */
export async function shutdownHarnessDaemonSupervised(
  options: ShutdownHarnessDaemonSupervisedOptions = {},
): Promise<void> {
  const dataRoot = resolveHarnessDataRoot(options.dataRoot);
  const runtimeDirectory =
    options.runtimeDirectory ?? resolveHarnessRuntimeDirectory(dataRoot);
  const lockPath = resolveHarnessUserLockPath(runtimeDirectory);

  if (!fs.existsSync(lockPath)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Nenhum harness-daemon ativo para encerrar.",
      [`Lock ausente em ${lockPath}`],
    );
  }

  const record = readUserDaemonLockRecord(runtimeDirectory);
  if (!record) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Lock do harness-daemon inválido.",
      [`Lock corrompido em ${lockPath}`],
    );
  }

  const timeoutMs = options.signalTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS;
  const address = resolveHarnessDaemonAddress(runtimeDirectory, options.instanceId);

  if (isHarnessDaemonProcessAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // Processo já encerrado.
    }
    const exited = await waitForProcessExit(record.pid, timeoutMs);
    if (!exited && isHarnessDaemonProcessAlive(record.pid)) {
      try {
        process.kill(record.pid, "SIGKILL");
      } catch {
        // Best-effort.
      }
      await waitForProcessExit(record.pid, timeoutMs);
    }
  }

  unlinkSocketIfExists(address);
  removeUserDaemonLockFile(runtimeDirectory);
}
