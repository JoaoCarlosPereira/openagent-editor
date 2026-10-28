import { spawnSync } from "node:child_process";

export type MacNativeSandboxPrimitive = "sandbox-exec";

export interface MacosSandboxProbeResult {
  nativeAvailable: boolean;
  primitive: MacNativeSandboxPrimitive | null;
  /** Utilitário sandbox-exec presente no PATH. */
  sandboxExecAvailable: boolean;
  /** Seatbelt responde a um perfil mínimo (sandbox-exec operacional). */
  seatbeltOperational: boolean;
}

export type MacosSandboxProbe = () => MacosSandboxProbeResult;

function commandExists(command: string): boolean {
  const result = spawnSync("command", ["-v", command], {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout?.trim().length ?? 0) > 0;
}

const MINIMAL_SEATBELT_PROFILE = ["(version 1)", "(allow default)"].join("\n");

/** Verifica se sandbox-exec aceita um perfil Seatbelt mínimo. */
export function probeSeatbeltOperational(): boolean {
  const trial = spawnSync(
    "sandbox-exec",
    ["-p", MINIMAL_SEATBELT_PROFILE, "true"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return trial.status === 0;
}

/**
 * Detecta primitives de sandbox nativa no macOS (sandbox-exec / Seatbelt).
 */
export function probeMacosSandbox(options?: {
  hasCommand?: (command: string) => boolean;
  probeSeatbelt?: () => boolean;
  /** Somente testes: simula host darwin fora do macOS. */
  platform?: NodeJS.Platform;
}): MacosSandboxProbeResult {
  const platform = options?.platform ?? process.platform;
  if (platform !== "darwin") {
    return {
      nativeAvailable: false,
      primitive: null,
      sandboxExecAvailable: false,
      seatbeltOperational: false,
    };
  }

  const hasCommand = options?.hasCommand ?? commandExists;
  const sandboxExecAvailable = hasCommand("sandbox-exec");
  const seatbeltOperational =
    options?.probeSeatbelt?.() ??
    (sandboxExecAvailable ? probeSeatbeltOperational() : false);

  if (sandboxExecAvailable && seatbeltOperational) {
    return {
      nativeAvailable: true,
      primitive: "sandbox-exec",
      sandboxExecAvailable: true,
      seatbeltOperational: true,
    };
  }

  return {
    nativeAvailable: false,
    primitive: null,
    sandboxExecAvailable,
    seatbeltOperational,
  };
}
