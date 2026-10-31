import { spawnSync } from "node:child_process";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export interface ExecWorkspaceCommandResult {
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeCommand(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Comando inválido.");
  }
  return raw.trim();
}

/**
 * Executa comando no diretório do workspace com stdout/stderr capturados.
 */
export function execWorkspaceCommand(
  workspaceRoot: string,
  commandInput: unknown,
  options?: { timeoutMs?: number; maxOutputBytes?: number },
): ExecWorkspaceCommandResult {
  const command = normalizeCommand(commandInput);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const result = spawnSync(command, {
    cwd: workspaceRoot,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer,
  });

  return {
    command,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
  };
}
