import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  allocateLoopbackPort,
  buildLoopbackOpenAiBaseUrl,
} from "./cliproxy-ephemeral-bind.js";
import {
  generateCliProxySidecarRuntimeSecrets,
  renderCliProxySidecarConfigV8,
  writeCliProxySidecarConfigFile,
  type CliProxySidecarRuntimeSecrets,
} from "./cliproxy-sidecar-config.js";
import { checkCliProxySidecarHealth } from "./cliproxy-sidecar-health.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_SIGNAL_TIMEOUT_MS = 5_000;

export type CliProxySidecarSupervisorHandle = {
  pid: number;
  host: typeof DEFAULT_HOST;
  port: number;
  openAiBaseUrl: string;
  secrets: CliProxySidecarRuntimeSecrets;
  configPath: string;
  runtimeDirectory: string;
  child: ChildProcess;
};

export type SidecarProcessSpawnInput = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export type CliProxySidecarLaunchContext = {
  binaryPath: string;
  configPath: string;
  port: number;
  host: typeof DEFAULT_HOST;
  secrets: CliProxySidecarRuntimeSecrets;
  runtimeDirectory: string;
};

export type StartCliProxySidecarSupervisorOptions = {
  runtimeDirectory?: string;
  binaryPath?: string;
  host?: typeof DEFAULT_HOST;
  healthTimeoutMs?: number;
  buildLaunchSpec?: (context: CliProxySidecarLaunchContext) => SidecarProcessSpawnInput;
  spawnProcess?: (input: SidecarProcessSpawnInput) => ChildProcess;
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

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }
  return !isProcessAlive(pid);
}

function defaultRuntimeDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openagent-cliproxy-"));
}

function resolveSidecarBinaryPath(explicit?: string): string {
  const binaryPath = explicit?.trim();
  if (!binaryPath) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Binário do sidecar CLIProxyAPI não configurado para spawn.",
      ["binaryPath"],
    );
  }
  return binaryPath;
}

function buildSidecarLaunchSpec(input: {
  binaryPath: string;
  configPath: string;
  port: number;
  secrets: CliProxySidecarRuntimeSecrets;
}): SidecarProcessSpawnInput {
  return {
    command: input.binaryPath,
    args: ["run", "--config", input.configPath],
    cwd: path.dirname(input.configPath),
    env: {
      ...process.env,
      OPENAGENT_CLIPROXY_PORT: String(input.port),
      OPENAGENT_CLIPROXY_ACCESS_TOKEN: input.secrets.accessToken,
      OPENAGENT_CLIPROXY_MANAGEMENT_SECRET: input.secrets.managementSecret,
    },
  };
}

async function waitForSidecarHealth(
  handle: Pick<CliProxySidecarSupervisorHandle, "openAiBaseUrl" | "secrets">,
  options: { healthTimeoutMs: number; fetchImpl?: typeof fetch },
): Promise<void> {
  const deadline = Date.now() + options.healthTimeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
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
    "Timeout aguardando health check do sidecar CLIProxyAPI.",
  );
}

/**
 * Sobe o CLIProxyAPI em loopback com token efêmero, aguarda health check e retorna handle supervisionado.
 */
export async function startCliProxySidecarSupervised(
  options: StartCliProxySidecarSupervisorOptions = {},
): Promise<CliProxySidecarSupervisorHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = await allocateLoopbackPort(host);
  const secrets = generateCliProxySidecarRuntimeSecrets();
  const runtimeDirectory = options.runtimeDirectory ?? defaultRuntimeDirectory();
  const configBody = renderCliProxySidecarConfigV8({ host, port, secrets });
  const configPath = writeCliProxySidecarConfigFile(runtimeDirectory, configBody);
  const openAiBaseUrl = buildLoopbackOpenAiBaseUrl(port);

  if (!options.buildLaunchSpec && !options.binaryPath?.trim()) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Informe binaryPath ou buildLaunchSpec para iniciar o sidecar.",
      ["binaryPath"],
    );
  }

  const binaryPath = options.binaryPath?.trim()
    ? resolveSidecarBinaryPath(options.binaryPath)
    : process.execPath;

  const spawnProcess =
    options.spawnProcess ??
    ((input: SidecarProcessSpawnInput) =>
      spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: "pipe",
      }));

  const launchContext: CliProxySidecarLaunchContext = {
    binaryPath,
    configPath,
    port,
    host,
    secrets,
    runtimeDirectory,
  };
  const launch = options.buildLaunchSpec
    ? options.buildLaunchSpec(launchContext)
    : buildSidecarLaunchSpec({ binaryPath, configPath, port, secrets });
  const child = spawnProcess(launch);
  if (!child.pid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Falha ao iniciar processo do sidecar CLIProxyAPI.",
    );
  }

  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  try {
    await waitForSidecarHealth({ openAiBaseUrl, secrets }, { healthTimeoutMs, fetchImpl: options.fetchImpl });
  } catch (error) {
    await shutdownCliProxySidecarSupervised({
      pid: child.pid,
      host,
      port,
      openAiBaseUrl,
      secrets,
      configPath,
      runtimeDirectory,
      child,
    }).catch(() => undefined);
    throw error;
  }

  return {
    pid: child.pid,
    host,
    port,
    openAiBaseUrl,
    secrets,
    configPath,
    runtimeDirectory,
    child,
  };
}

/**
 * Encerra o sidecar com SIGTERM/SIGKILL supervisionados e remove config efêmera.
 */
export async function shutdownCliProxySidecarSupervised(
  handle: CliProxySidecarSupervisorHandle,
  options: { signalTimeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.signalTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS;
  const { pid, child } = handle;

  if (isProcessAlive(pid)) {
    try {
      child.kill("SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Processo já encerrado.
      }
    }
    const exited = await waitForProcessExit(pid, timeoutMs);
    if (!exited && isProcessAlive(pid)) {
      try {
        child.kill("SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Best-effort.
        }
      }
      await waitForProcessExit(pid, timeoutMs);
    }
  }

  try {
    fs.unlinkSync(handle.configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
