import {
  probeLinuxSandbox,
  type LinuxSandboxProbe,
} from "./linux-sandbox-probe.js";
import {
  probeMacosSandbox,
  type MacosSandboxProbe,
} from "./macos-sandbox-probe.js";

/**
 * Nível de isolamento disponível no SO (ADR-006). Degradação explícita antes do consentimento.
 */
export type SandboxIsolationLevel = "native" | "degraded";

export interface SandboxCapabilitySnapshot {
  level: SandboxIsolationLevel;
  platform: NodeJS.Platform;
  /** Primitive nativa quando level === native (ex.: bubblewrap). */
  nativePrimitive?: string;
  /** Mensagem para UI quando não há primitive nativa completa. */
  degradationNotice?: string;
}

export interface DescribeSandboxCapabilityOptions {
  linuxProbe?: LinuxSandboxProbe;
  macosProbe?: MacosSandboxProbe;
  /** Somente testes: simula plataforma distinta de process.platform. */
  platform?: NodeJS.Platform;
}

const WORKER_THREAD_DEGRADED_NOTICE =
  "Isolamento via worker thread; sandbox nativa do SO indisponível neste ambiente.";

/**
 * Descreve o nível de sandbox do host atual, com degradação explícita (ADR-006).
 */
export function describeSandboxCapability(
  options?: DescribeSandboxCapabilityOptions,
): SandboxCapabilitySnapshot {
  const platform = options?.platform ?? process.platform;

  if (platform === "linux") {
    const probe = (options?.linuxProbe ?? probeLinuxSandbox)();
    if (probe.nativeAvailable && probe.primitive) {
      return {
        level: "native",
        platform,
        nativePrimitive: probe.primitive,
      };
    }

    const degradationNotice = probe.unshareUserNsAvailable
      ? "Bubblewrap e unshare não encontrados; isolamento limitado a worker thread."
      : "User namespaces indisponíveis; sandbox nativa degradada para worker thread.";

    return {
      level: "degraded",
      platform,
      degradationNotice,
    };
  }

  if (platform === "darwin") {
    const probe = (
      options?.macosProbe ??
      (() =>
        probeMacosSandbox({
          platform: options?.platform,
        }))
    )();
    if (probe.nativeAvailable && probe.primitive) {
      return {
        level: "native",
        platform,
        nativePrimitive: probe.primitive,
      };
    }

    const degradationNotice = probe.sandboxExecAvailable
      ? "sandbox-exec presente mas Seatbelt não operacional; isolamento limitado a worker thread."
      : "Seatbelt indisponível; sandbox nativa degradada para worker thread.";

    return {
      level: "degraded",
      platform,
      degradationNotice,
    };
  }

  return {
    level: "degraded",
    platform,
    degradationNotice: `Sandbox nativa para ${platform} será entregue em tarefa dedicada; ${WORKER_THREAD_DEGRADED_NOTICE}`,
  };
}
