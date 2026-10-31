import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type LinuxNativeSandboxPrimitive = "bubblewrap" | "unshare";

export interface LinuxSandboxProbeResult {
  nativeAvailable: boolean;
  primitive: LinuxNativeSandboxPrimitive | null;
  unshareUserNsAvailable: boolean;
}

export type LinuxSandboxProbe = () => LinuxSandboxProbeResult;

function commandExists(command: string): boolean {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout?.trim().length ?? 0) > 0;
}

/** Heurística leve: user namespaces habilitados sem spawn de unshare real. */
export function probeUnshareUserNamespaceAvailability(): boolean {
  try {
    const maxUserNs = readFileSync("/proc/sys/user/max_user_namespaces", "utf8").trim();
    if (maxUserNs === "0") {
      return false;
    }
  } catch {
    // sysctl ausente — tenta unshare abaixo.
  }

  const trial = spawnSync("unshare", ["--user", "--map-root-user", "--", "true"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return trial.status === 0;
}

/**
 * Detecta primitives de sandbox nativa no Linux (bubblewrap preferido, depois unshare).
 */
export function probeLinuxSandbox(
  options?: {
    probeUserNs?: () => boolean;
    hasCommand?: (command: string) => boolean;
  },
): LinuxSandboxProbeResult {
  if (process.platform !== "linux") {
    return {
      nativeAvailable: false,
      primitive: null,
      unshareUserNsAvailable: false,
    };
  }

  const hasCommand = options?.hasCommand ?? commandExists;
  const unshareUserNsAvailable =
    options?.probeUserNs?.() ?? probeUnshareUserNamespaceAvailability();

  if (hasCommand("bwrap")) {
    return {
      nativeAvailable: true,
      primitive: "bubblewrap",
      unshareUserNsAvailable,
    };
  }

  if (hasCommand("unshare") && unshareUserNsAvailable) {
    return {
      nativeAvailable: true,
      primitive: "unshare",
      unshareUserNsAvailable: true,
    };
  }

  return {
    nativeAvailable: false,
    primitive: null,
    unshareUserNsAvailable,
  };
}
