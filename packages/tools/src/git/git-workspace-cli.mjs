import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const MAX_GIT_OUTPUT_BYTES = 512 * 1024;

/**
 * @param {string} workspaceRoot
 * @param {string[]} gitArgs
 */
export function runGitInWorkspace(workspaceRoot, gitArgs) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new Error("Raiz do workspace inválida.");
  }
  const root = path.resolve(workspaceRoot.trim());
  const gitDir = path.join(root, ".git");
  if (!existsSync(gitDir)) {
    throw new Error("Diretório não é um repositório Git.");
  }

  const result = spawnSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    signal: result.signal,
  };
}

/**
 * @param {{ workspaceRoot: string }} input
 */
export function gitStatusInWorkspace(input) {
  const workspaceRoot = input?.workspaceRoot;
  const result = runGitInWorkspace(workspaceRoot, ["status", "--porcelain=v1", "-b"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Falha ao executar git status.");
  }
  return {
    command: "git status --porcelain=v1 -b",
    ...result,
  };
}

/**
 * @param {{ workspaceRoot: string, relativePath?: string }} input
 */
export function gitDiffInWorkspace(input) {
  const workspaceRoot = input?.workspaceRoot;
  const relativePath =
    typeof input?.relativePath === "string" && input.relativePath.trim()
      ? input.relativePath.trim()
      : undefined;

  if (relativePath && path.isAbsolute(relativePath)) {
    throw new Error("Caminho relativo inválido.");
  }

  const args = ["diff", "--"];
  if (relativePath) {
    args.push(relativePath);
  }

  const result = runGitInWorkspace(workspaceRoot, args);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Falha ao executar git diff.");
  }
  return {
    command: relativePath ? `git diff -- ${relativePath}` : "git diff",
    relativePath: relativePath ?? null,
    ...result,
  };
}

/**
 * @param {{ workspaceRoot: string; worktreePath: string; branchName: string }} input
 */
export function createIsolatedWorktreeInWorkspace(input) {
  const workspaceRoot = input?.workspaceRoot;
  const worktreePath = input?.worktreePath;
  const branchName = input?.branchName;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new Error("Raiz do workspace inválida.");
  }
  if (typeof worktreePath !== "string" || !worktreePath.trim()) {
    throw new Error("Caminho do worktree inválido.");
  }
  if (typeof branchName !== "string" || !branchName.trim()) {
    throw new Error("Nome de branch inválido.");
  }

  const resolvedWorktree = path.resolve(worktreePath.trim());
  const result = runGitInWorkspace(workspaceRoot, [
    "worktree",
    "add",
    "-b",
    branchName.trim(),
    resolvedWorktree,
    "HEAD",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Falha ao executar git worktree add.");
  }
  return {
    command: `git worktree add -b ${branchName.trim()} ${resolvedWorktree} HEAD`,
    worktreePath: resolvedWorktree,
    branchName: branchName.trim(),
    ...result,
  };
}

/**
 * @param {{ workspaceRoot: string; worktreePath: string }} input
 */
export function removeIsolatedWorktreeFromWorkspace(input) {
  const workspaceRoot = input?.workspaceRoot;
  const worktreePath = input?.worktreePath;
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw new Error("Raiz do workspace inválida.");
  }
  if (typeof worktreePath !== "string" || !worktreePath.trim()) {
    throw new Error("Caminho do worktree inválido.");
  }
  const resolvedWorktree = path.resolve(worktreePath.trim());
  const result = runGitInWorkspace(workspaceRoot, [
    "worktree",
    "remove",
    "--force",
    resolvedWorktree,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Falha ao executar git worktree remove.");
  }
  return {
    command: `git worktree remove --force ${resolvedWorktree}`,
    worktreePath: resolvedWorktree,
    ...result,
  };
}
