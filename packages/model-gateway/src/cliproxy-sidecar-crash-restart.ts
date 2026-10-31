import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { checkCliProxySidecarHealth } from "./cliproxy-sidecar-health.js";
import {
  startCliProxySidecarSupervised,
  type CliProxySidecarSupervisorHandle,
  type SidecarProcessSpawnInput,
  type StartCliProxySidecarSupervisorOptions,
} from "./cliproxy-sidecar-supervisor.js";

const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export type CliProxySidecarMetrics = {
  crashCount: number;
  restartCount: number;
  lastCrashAt: string | null;
};

export type CliProxySidecarCrashRecoverySession = {
  handle: CliProxySidecarSupervisorHandle;
  launch: SidecarProcessSpawnInput;
  metrics: CliProxySidecarMetrics;
  spawnProcess: (input: SidecarProcessSpawnInput) => ChildProcess;
  healthTimeoutMs: number;
  fetchImpl?: typeof fetch;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createEmptyCliProxySidecarMetrics(): CliProxySidecarMetrics {
  return { crashCount: 0, restartCount: 0, lastCrashAt: null };
}

export function recordCliProxySidecarProcessCrash(metrics: CliProxySidecarMetrics): void {
  metrics.crashCount += 1;
  metrics.lastCrashAt = new Date().toISOString();
}

function wrapLaunchCapture(options: StartCliProxySidecarSupervisorOptions): {
  wrapped: StartCliProxySidecarSupervisorOptions;
  readLaunch: () => SidecarProcessSpawnInput;
} {
  let captured: SidecarProcessSpawnInput | undefined;
  const wrapped: StartCliProxySidecarSupervisorOptions = {
    ...options,
    buildLaunchSpec: (context) => {
      if (options.buildLaunchSpec) {
        captured = options.buildLaunchSpec(context);
      } else {
        captured = {
          command: context.binaryPath,
          args: ["run", "--config", context.configPath],
          cwd: path.dirname(context.configPath),
          env: {
            ...process.env,
            OPENAGENT_CLIPROXY_PORT: String(context.port),
            OPENAGENT_CLIPROXY_ACCESS_TOKEN: context.secrets.accessToken,
            OPENAGENT_CLIPROXY_MANAGEMENT_SECRET: context.secrets.managementSecret,
          },
        };
      }
      return captured;
    },
  };
  return {
    wrapped,
    readLaunch: () => {
      if (!captured) {
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          "Launch do sidecar não capturado para reinício.",
        );
      }
      return captured;
    },
  };
}

async function waitForSidecarHealthAfterRestart(
  handle: Pick<CliProxySidecarSupervisorHandle, "openAiBaseUrl" | "secrets">,
  options: { healthTimeoutMs: number; fetchImpl?: typeof fetch; child?: ChildProcess },
): Promise<void> {
  let childExitError: ProtocolError | undefined;
  const onChildExit = (code: number | null, signal: NodeJS.Signals | null) => {
    childExitError = new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Sidecar CLIProxyAPI encerrou durante reinício (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
    );
  };
  options.child?.once("exit", onChildExit);

  try {
    const deadline = Date.now() + options.healthTimeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (childExitError) {
        throw childExitError;
      }
      try {
        await checkCliProxySidecarHealth({
          openAiBaseUrl: handle.openAiBaseUrl,
          accessToken: handle.secrets.accessToken,
          fetchImpl: options.fetchImpl,
          timeoutMs: Math.min(2_000, options.healthTimeoutMs),
        });
        return;
      } catch (error) {
        lastError = error;
        await sleep(DEFAULT_POLL_INTERVAL_MS);
      }
    }
    if (lastError instanceof ProtocolError) {
      throw lastError;
    }
    throw new ProtocolError(
      "PROVIDER_CONNECTION_FAILED",
      "Timeout aguardando health check após reinício do sidecar CLIProxyAPI.",
    );
  } finally {
    options.child?.off("exit", onChildExit);
  }
}

/**
 * Sobe o sidecar supervisionado e guarda o launch spec para reinício pós-crash com métricas locais.
 */
export async function startCliProxySidecarCrashRecoverySession(
  options: StartCliProxySidecarSupervisorOptions = {},
): Promise<CliProxySidecarCrashRecoverySession> {
  const { wrapped, readLaunch } = wrapLaunchCapture(options);
  const spawnProcess =
    options.spawnProcess ??
    ((input: SidecarProcessSpawnInput) =>
      spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: "ignore",
      }));

  const handle = await startCliProxySidecarSupervised({
    ...wrapped,
    spawnProcess,
  });

  return {
    handle,
    launch: readLaunch(),
    metrics: createEmptyCliProxySidecarMetrics(),
    spawnProcess,
    healthTimeoutMs: options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
    fetchImpl: options.fetchImpl,
  };
}

/**
 * Reinicia o processo do sidecar após crash, preservando bind/token/config e incrementando métricas.
 */
async function waitForProcessNotAlive(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }
}

export async function restartCliProxySidecarAfterCrash(
  session: CliProxySidecarCrashRecoverySession,
): Promise<void> {
  const { handle } = session;
  await waitForProcessNotAlive(handle.pid, 5_000);
  if (isProcessAlive(handle.pid)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Sidecar ainda em execução; reinício só é permitido após crash.",
      ["pid"],
    );
  }

  const child = session.spawnProcess(session.launch);
  if (!child.pid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Falha ao reiniciar processo do sidecar CLIProxyAPI.",
    );
  }

  session.metrics.restartCount += 1;
  handle.pid = child.pid;
  handle.child = child;

  await waitForSidecarHealthAfterRestart(
    { openAiBaseUrl: handle.openAiBaseUrl, secrets: handle.secrets },
    {
      healthTimeoutMs: session.healthTimeoutMs,
      fetchImpl: session.fetchImpl,
      child,
    },
  );
}
