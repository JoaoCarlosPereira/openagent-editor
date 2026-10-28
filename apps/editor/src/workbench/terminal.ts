import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export { OUT_OF_SCOPE_PATH_LOG_MESSAGE };

export const TERMINAL_FOLDER_REQUIRED_MESSAGE =
  "Pasta raiz obrigatória para o terminal integrado.";
export const TERMINAL_NO_SESSION_MESSAGE =
  "Nenhuma sessão de terminal aberta no workbench.";
export const TERMINAL_COMMAND_REQUIRED_MESSAGE =
  "Comando inválido para o terminal integrado.";
export const TERMINAL_DIRECTORY_REQUIRED_MESSAGE =
  "Diretório de trabalho inválido para o terminal integrado.";
export const TERMINAL_NOT_A_DIRECTORY_MESSAGE =
  "O caminho não aponta para um diretório de trabalho válido.";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;

export type IntegratedTerminalStatus = "idle" | "exited";

export interface IntegratedTerminalSession {
  /** Identificador estável da sessão aberta no workbench. */
  id: string;
  /** CWD absoluto canônico sob a pasta do workspace. */
  cwd: string;
  /** CWD relativo ao root ("" = raiz da pasta). Separador `/`. */
  relativeCwd: string;
  /** Buffer acumulado de stdout/stderr (efeito observável). */
  output: string;
  /** Último comando executado (null se nenhum). */
  lastCommand: string | null;
  /** Exit code do último comando (null se nenhum ou sinal). */
  lastExitCode: number | null;
  status: IntegratedTerminalStatus;
}

function assertNonEmptyRoot(rootFolder: unknown): string {
  if (typeof rootFolder !== "string" || rootFolder.trim() === "") {
    throw new ProtocolError("INVALID_STATE", TERMINAL_FOLDER_REQUIRED_MESSAGE, [
      `rootFolder=${String(rootFolder)}`,
    ]);
  }
  return path.resolve(rootFolder.trim());
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function resolveDirectoryUnderRoot(
  rootFolder: string,
  relativeDirectory: string,
): { canonicalPath: string; relativePath: string } {
  const requested =
    relativeDirectory === "" ? rootFolder : path.join(rootFolder, relativeDirectory);
  const resolved = resolveCanonicalWorkspacePath(rootFolder, requested);
  if (!resolved.ok) {
    throw resolved.error;
  }
  if (!existsSync(resolved.canonicalPath) || !statSync(resolved.canonicalPath).isDirectory()) {
    throw new ProtocolError("INVALID_STATE", TERMINAL_NOT_A_DIRECTORY_MESSAGE, [
      `relativeDirectory=${relativeDirectory}`,
    ]);
  }
  const relative =
    resolved.canonicalPath === rootFolder
      ? ""
      : toPosixRelative(path.relative(rootFolder, resolved.canonicalPath));
  return { canonicalPath: resolved.canonicalPath, relativePath: relative };
}

/**
 * Abre uma sessão de terminal integrada com CWD na pasta do workspace (LOC-01 / task_122).
 */
export function openIntegratedTerminal(rootFolder: unknown): IntegratedTerminalSession {
  const root = assertNonEmptyRoot(rootFolder);
  return {
    id: randomUUID(),
    cwd: root,
    relativeCwd: "",
    output: "",
    lastCommand: null,
    lastExitCode: null,
    status: "idle",
  };
}

/**
 * Altera o CWD da sessão sob o root (fora do escopo → OUT_OF_SCOPE).
 */
export function setIntegratedTerminalCwd(
  rootFolder: unknown,
  session: IntegratedTerminalSession | null,
  relativeDirectory: unknown,
): IntegratedTerminalSession {
  if (session === null) {
    throw new ProtocolError("INVALID_STATE", TERMINAL_NO_SESSION_MESSAGE, []);
  }
  const root = assertNonEmptyRoot(rootFolder);
  if (typeof relativeDirectory !== "string") {
    throw new ProtocolError("INVALID_STATE", TERMINAL_DIRECTORY_REQUIRED_MESSAGE, [
      `relativeDirectory=${String(relativeDirectory)}`,
    ]);
  }
  const relative = relativeDirectory.trim().split(path.sep).join("/");
  if (relative.startsWith("/") || path.isAbsolute(relativeDirectory.trim())) {
    throw new ProtocolError("INVALID_STATE", TERMINAL_DIRECTORY_REQUIRED_MESSAGE, [
      `relativeDirectory=${relativeDirectory}`,
    ]);
  }
  const dir = resolveDirectoryUnderRoot(root, relative);
  return {
    ...session,
    cwd: dir.canonicalPath,
    relativeCwd: dir.relativePath,
  };
}

/**
 * Executa um comando no CWD da sessão (shell do SO; I/O no main).
 */
export function runIntegratedTerminalCommand(
  rootFolder: unknown,
  session: IntegratedTerminalSession | null,
  commandInput: unknown,
  options?: { timeoutMs?: number },
): IntegratedTerminalSession {
  if (session === null) {
    throw new ProtocolError("INVALID_STATE", TERMINAL_NO_SESSION_MESSAGE, []);
  }
  const root = assertNonEmptyRoot(rootFolder);
  // Revalida confinamento do CWD atual antes de spawn.
  resolveDirectoryUnderRoot(root, session.relativeCwd);

  if (typeof commandInput !== "string" || commandInput.trim() === "") {
    throw new ProtocolError("INVALID_STATE", TERMINAL_COMMAND_REQUIRED_MESSAGE, [
      `command=${String(commandInput)}`,
    ]);
  }
  const command = commandInput.trim();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const result = spawnSync(command, {
    cwd: session.cwd,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: DEFAULT_MAX_OUTPUT_BYTES,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const chunk = [stdout, stderr].filter((part) => part.length > 0).join("");
  const promptLine = `$ ${command}\n`;
  const exitCode = result.status;

  return {
    ...session,
    output: `${session.output}${promptLine}${chunk}`,
    lastCommand: command,
    lastExitCode: exitCode,
    status: "exited",
  };
}
