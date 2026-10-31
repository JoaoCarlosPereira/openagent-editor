import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export { OUT_OF_SCOPE_PATH_LOG_MESSAGE };

export const GIT_PANEL_FOLDER_REQUIRED_MESSAGE =
  "Pasta raiz obrigatória para o painel Git.";
export const GIT_PANEL_NO_PANEL_MESSAGE =
  "Nenhum painel Git aberto no workbench.";
export const GIT_PANEL_NOT_A_REPOSITORY_MESSAGE =
  "A pasta aberta não é um repositório Git.";
export const GIT_PANEL_PATH_REQUIRED_MESSAGE =
  "Caminho relativo inválido para o diff Git.";
export const GIT_PANEL_STATUS_FAILED_MESSAGE =
  "Falha ao executar git status no workspace.";
export const GIT_PANEL_DIFF_FAILED_MESSAGE =
  "Falha ao executar git diff no workspace.";

const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const STATUS_COMMAND = "git status --porcelain=v1 -b";

export interface IntegratedGitPanel {
  /** Identificador estável do painel aberto. */
  id: string;
  /** Root absoluto canônico da pasta do workspace. */
  workspaceRoot: string;
  statusCommand: string;
  statusStdout: string;
  statusStderr: string;
  statusExitCode: number | null;
  /** null até o primeiro loadGitPanelDiff. */
  diffCommand: string | null;
  diffRelativePath: string | null;
  diffStdout: string;
  diffStderr: string;
  diffExitCode: number | null;
}

function assertNonEmptyRoot(rootFolder: unknown): string {
  if (typeof rootFolder !== "string" || rootFolder.trim() === "") {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_FOLDER_REQUIRED_MESSAGE, [
      `rootFolder=${String(rootFolder)}`,
    ]);
  }
  return path.resolve(rootFolder.trim());
}

function assertGitRepository(root: string): void {
  const gitDir = path.join(root, ".git");
  if (!existsSync(gitDir)) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_NOT_A_REPOSITORY_MESSAGE, [
      `workspaceRoot=${root}`,
    ]);
  }
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function normalizeOptionalRelativePath(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_PATH_REQUIRED_MESSAGE, [
      `relativePath=${String(raw)}`,
    ]);
  }
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/")) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_PATH_REQUIRED_MESSAGE, [
      `relativePath=${trimmed}`,
    ]);
  }
  return toPosixRelative(trimmed);
}

function resolveRelativeUnderRoot(
  rootFolder: string,
  relativePath: string,
): string {
  const requested = path.join(rootFolder, relativePath);
  const resolved = resolveCanonicalWorkspacePath(rootFolder, requested);
  if (!resolved.ok) {
    throw resolved.error;
  }
  return toPosixRelative(path.relative(rootFolder, resolved.canonicalPath));
}

function runGit(
  root: string,
  gitArgs: readonly string[],
): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync("git", [...gitArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

function captureStatus(root: string): Pick<
  IntegratedGitPanel,
  "statusCommand" | "statusStdout" | "statusStderr" | "statusExitCode"
> {
  const result = runGit(root, ["status", "--porcelain=v1", "-b"]);
  if (result.exitCode !== 0) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_STATUS_FAILED_MESSAGE, [
      result.stderr.trim() || `exitCode=${String(result.exitCode)}`,
    ]);
  }
  return {
    statusCommand: STATUS_COMMAND,
    statusStdout: result.stdout,
    statusStderr: result.stderr,
    statusExitCode: result.exitCode,
  };
}

function captureDiff(
  root: string,
  relativePath: string | undefined,
): Pick<
  IntegratedGitPanel,
  "diffCommand" | "diffRelativePath" | "diffStdout" | "diffStderr" | "diffExitCode"
> {
  const args = ["diff", "--"];
  if (relativePath) {
    args.push(relativePath);
  }
  const result = runGit(root, args);
  if (result.exitCode !== 0) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_DIFF_FAILED_MESSAGE, [
      result.stderr.trim() || `exitCode=${String(result.exitCode)}`,
    ]);
  }
  return {
    diffCommand: relativePath ? `git diff -- ${relativePath}` : "git diff",
    diffRelativePath: relativePath ?? null,
    diffStdout: result.stdout,
    diffStderr: result.stderr,
    diffExitCode: result.exitCode,
  };
}

/**
 * Abre o painel Git e carrega status porcelain (LOC-01 / task_123).
 */
export function openIntegratedGitPanel(rootFolder: unknown): IntegratedGitPanel {
  const root = assertNonEmptyRoot(rootFolder);
  assertGitRepository(root);
  const status = captureStatus(root);
  return {
    id: randomUUID(),
    workspaceRoot: root,
    ...status,
    diffCommand: null,
    diffRelativePath: null,
    diffStdout: "",
    diffStderr: "",
    diffExitCode: null,
  };
}

/**
 * Atualiza o status Git do painel aberto.
 */
export function refreshIntegratedGitStatus(
  rootFolder: unknown,
  panel: IntegratedGitPanel | null,
): IntegratedGitPanel {
  if (panel === null) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_NO_PANEL_MESSAGE, []);
  }
  const root = assertNonEmptyRoot(rootFolder);
  assertGitRepository(root);
  const status = captureStatus(root);
  return {
    ...panel,
    workspaceRoot: root,
    ...status,
  };
}

/**
 * Carrega git diff (workspace inteiro ou caminho relativo confinado).
 * Fora do root → OUT_OF_SCOPE; path inválido → INVALID_STATE.
 */
export function loadIntegratedGitDiff(
  rootFolder: unknown,
  panel: IntegratedGitPanel | null,
  relativePath?: unknown,
): IntegratedGitPanel {
  if (panel === null) {
    throw new ProtocolError("INVALID_STATE", GIT_PANEL_NO_PANEL_MESSAGE, []);
  }
  const root = assertNonEmptyRoot(rootFolder);
  assertGitRepository(root);
  const optionalRelative = normalizeOptionalRelativePath(relativePath);
  const confinedRelative =
    optionalRelative === undefined
      ? undefined
      : resolveRelativeUnderRoot(root, optionalRelative);
  const diff = captureDiff(root, confinedRelative);
  return {
    ...panel,
    workspaceRoot: root,
    ...diff,
  };
}
