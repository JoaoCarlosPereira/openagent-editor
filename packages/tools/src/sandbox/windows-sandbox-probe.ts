import { spawnSync } from "node:child_process";
import { release as osRelease } from "node:os";

export type WindowsNativeSandboxPrimitive = "appcontainer" | "job-object";

export interface WindowsSandboxProbeResult {
  nativeAvailable: boolean;
  primitive: WindowsNativeSandboxPrimitive | null;
  /** AppContainer disponível no kernel (Windows 8+). */
  appContainerSupported: boolean;
  /** Ambiente consegue criar perfil AppContainer mínimo (heurística leve). */
  appContainerOperational: boolean;
  /** Job Objects disponíveis para isolamento de processo. */
  jobObjectAvailable: boolean;
}

export type WindowsSandboxProbe = () => WindowsSandboxProbeResult;

/** AppContainer exige Windows 8 / Server 2012 (NT 6.2) ou superior. */
export function probeAppContainerVersionSupport(version?: string): boolean {
  const parsed = parseWindowsReleaseVersion(version ?? osRelease());
  if (!parsed) {
    return false;
  }
  const { major, minor } = parsed;
  return major > 6 || (major === 6 && minor >= 2);
}

function parseWindowsReleaseVersion(release: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)/.exec(release.trim());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Heurística: PowerShell responde (pré-requisito comum para APIs AppContainer via host). */
export function probeAppContainerOperational(): boolean {
  const trial = spawnSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", "powershell -NoProfile -NonInteractive -Command exit 0"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  return trial.status === 0;
}

/** Job Objects existem em todas as edições Windows suportadas pelo produto. */
export function probeJobObjectAvailability(): boolean {
  const trial = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "exit 0"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return trial.status === 0;
}

/**
 * Detecta primitives de sandbox nativa no Windows (AppContainer preferido, depois Job Object).
 */
export function probeWindowsSandbox(options?: {
  probeAppContainerVersion?: () => boolean;
  probeAppContainer?: () => boolean;
  probeJobObject?: () => boolean;
  /** Somente testes: simula host win32 fora do Windows. */
  platform?: NodeJS.Platform;
  /** Somente testes: substitui osRelease(). */
  osRelease?: () => string;
}): WindowsSandboxProbeResult {
  const platform = options?.platform ?? process.platform;
  if (platform !== "win32") {
    return {
      nativeAvailable: false,
      primitive: null,
      appContainerSupported: false,
      appContainerOperational: false,
      jobObjectAvailable: false,
    };
  }

  const appContainerSupported =
    options?.probeAppContainerVersion?.() ??
    probeAppContainerVersionSupport(options?.osRelease?.() ?? osRelease());
  const appContainerOperational =
    options?.probeAppContainer?.() ??
    (appContainerSupported ? probeAppContainerOperational() : false);
  const jobObjectAvailable = options?.probeJobObject?.() ?? probeJobObjectAvailability();

  if (appContainerSupported && appContainerOperational) {
    return {
      nativeAvailable: true,
      primitive: "appcontainer",
      appContainerSupported: true,
      appContainerOperational: true,
      jobObjectAvailable,
    };
  }

  if (jobObjectAvailable) {
    return {
      nativeAvailable: true,
      primitive: "job-object",
      appContainerSupported,
      appContainerOperational,
      jobObjectAvailable: true,
    };
  }

  return {
    nativeAvailable: false,
    primitive: null,
    appContainerSupported,
    appContainerOperational,
    jobObjectAvailable,
  };
}
