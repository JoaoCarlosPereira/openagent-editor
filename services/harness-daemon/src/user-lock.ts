import fs from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { resolveHarnessUserLockPath } from "./runtime-paths.js";

export type UserDaemonLockRecord = {
  pid: number;
  username: string;
  startedAt: string;
};

export type UserDaemonLock = {
  record: UserDaemonLockRecord;
  release(): void;
};

export function isHarnessDaemonProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockRecord(lockPath: string): UserDaemonLockRecord | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as UserDaemonLockRecord).pid === "number" &&
      typeof (parsed as UserDaemonLockRecord).username === "string"
    ) {
      return parsed as UserDaemonLockRecord;
    }
  } catch {
    return null;
  }
  return null;
}

function tryRemoveStaleLock(lockPath: string): boolean {
  const record = readLockRecord(lockPath);
  if (!record) {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }
  if (isHarnessDaemonProcessAlive(record.pid)) {
    return false;
  }
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lock exclusivo por usuário local — apenas um daemon harness ativo (ADR-003).
 */
export function acquireUserDaemonLock(runtimeDirectory: string): UserDaemonLock {
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const lockPath = resolveHarnessUserLockPath(runtimeDirectory);
  const record: UserDaemonLockRecord = {
    pid: process.pid,
    username: userInfo().username,
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(lockPath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      if (tryRemoveStaleLock(lockPath)) {
        return acquireUserDaemonLock(runtimeDirectory);
      }
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Já existe um harness-daemon ativo para este usuário.",
        [`Lock em ${lockPath}`],
      );
    }
    throw error;
  }

  let released = false;
  return {
    record,
    release() {
      if (released) {
        return;
      }
      released = true;
      try {
        const current = readLockRecord(lockPath);
        if (current?.pid === record.pid) {
          fs.unlinkSync(lockPath);
        }
      } catch {
        // Best-effort ao encerrar.
      }
    },
  };
}

export function isUserDaemonLockHeld(runtimeDirectory: string): boolean {
  const lockPath = resolveHarnessUserLockPath(runtimeDirectory);
  if (!fs.existsSync(lockPath)) {
    return false;
  }
  const record = readLockRecord(lockPath);
  if (!record) {
    return false;
  }
  return isHarnessDaemonProcessAlive(record.pid);
}

export function readUserDaemonLockRecord(
  runtimeDirectory: string,
): UserDaemonLockRecord | null {
  const lockPath = resolveHarnessUserLockPath(runtimeDirectory);
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  return readLockRecord(lockPath);
}

export function removeUserDaemonLockFile(runtimeDirectory: string): void {
  const lockPath = resolveHarnessUserLockPath(runtimeDirectory);
  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function readUserDaemonLockPath(runtimeDirectory: string): string {
  return path.resolve(resolveHarnessUserLockPath(runtimeDirectory));
}
