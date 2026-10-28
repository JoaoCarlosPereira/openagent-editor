import os from "node:os";
import path from "node:path";
import { resolveLocalTransportAddress } from "@openagent/protocol";

const DEFAULT_INSTANCE_ID = "default";

export function resolveHarnessDataRoot(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return path.resolve(explicit.trim());
  }
  const xdgState = process.env["XDG_STATE_HOME"];
  if (xdgState && xdgState.trim().length > 0) {
    return path.join(path.resolve(xdgState.trim()), "openagent");
  }
  return path.join(os.homedir(), ".openagent");
}

export function resolveHarnessRuntimeDirectory(dataRoot: string): string {
  return path.join(dataRoot, "runtime");
}

export function resolveHarnessUserLockPath(runtimeDirectory: string): string {
  return path.join(runtimeDirectory, "openagent-harness-user.lock");
}

export function resolveHarnessDaemonAddress(
  runtimeDirectory: string,
  instanceId = DEFAULT_INSTANCE_ID,
): string {
  return resolveLocalTransportAddress(runtimeDirectory, instanceId);
}
