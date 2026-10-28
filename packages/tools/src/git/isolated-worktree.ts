import { existsSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import {
  createIsolatedWorktreeInWorkspace,
  removeIsolatedWorktreeFromWorkspace,
} from "./git-workspace-cli.mjs";

const ISOLATED_WORK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type CreateIsolatedGitWorkInput = {
  workspaceRoot: string;
  isolatedWorkId: string;
  worktreesRoot: string;
};

export type CreateIsolatedGitWorkResult = {
  isolatedWorkId: string;
  canonicalWorkspaceRoot: string;
  isolatedWorkspaceRoot: string;
  gitBranch: string;
};

function isolatedWorkInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function listWorkspaceFileContents(
  workspaceRoot: string,
  relativeDir = "",
): Record<string, string> {
  const absoluteDir = path.join(workspaceRoot, relativeDir);
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const snapshot: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(workspaceRoot, relativePath);
    if (entry.isDirectory()) {
      Object.assign(snapshot, listWorkspaceFileContents(workspaceRoot, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    snapshot[relativePath] = readFileSync(absolutePath, "utf8");
  }

  return snapshot;
}

function assertSnapshotsEqual(
  before: Record<string, string>,
  after: Record<string, string>,
): void {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  if (beforeKeys.length !== afterKeys.length) {
    isolatedWorkInvalid(
      "Criação de trabalho isolado alterou arquivos do workspace original.",
    );
  }
  for (let index = 0; index < beforeKeys.length; index += 1) {
    const key = beforeKeys[index] ?? "";
    if (afterKeys[index] !== key || after[key] !== before[key]) {
      isolatedWorkInvalid(
        "Criação de trabalho isolado alterou arquivos do workspace original.",
        [key],
      );
    }
  }
}

function buildIsolatedBranchName(isolatedWorkId: string): string {
  return `openagent/isolated/${isolatedWorkId}`;
}

/**
 * SES-04: cria worktree Git local; o workspace canônico permanece intacto até aplicação futura.
 */
export function createIsolatedGitWork(
  input: CreateIsolatedGitWorkInput,
): CreateIsolatedGitWorkResult {
  if (typeof input.workspaceRoot !== "string" || !input.workspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do workspace inválida.");
  }
  if (typeof input.isolatedWorkId !== "string" || !ISOLATED_WORK_ID_PATTERN.test(input.isolatedWorkId.trim())) {
    throw invalidToolInputError("Identificador de trabalho isolado inválido.");
  }
  if (typeof input.worktreesRoot !== "string" || !input.worktreesRoot.trim()) {
    throw invalidToolInputError("Diretório raiz de worktrees inválido.");
  }

  const canonicalWorkspaceRoot = path.resolve(input.workspaceRoot.trim());
  const isolatedWorkId = input.isolatedWorkId.trim();
  const worktreesRoot = path.resolve(input.worktreesRoot.trim());
  const isolatedWorkspaceRoot = path.join(worktreesRoot, isolatedWorkId);
  const gitBranch = buildIsolatedBranchName(isolatedWorkId);

  const canonicalInsideIsolated =
    isolatedWorkspaceRoot === canonicalWorkspaceRoot ||
    canonicalWorkspaceRoot.startsWith(`${isolatedWorkspaceRoot}${path.sep}`) ||
    isolatedWorkspaceRoot.startsWith(`${canonicalWorkspaceRoot}${path.sep}`);
  if (canonicalInsideIsolated) {
    isolatedWorkInvalid(
      "Caminho do worktree isolado não pode coincidir ou aninhar o workspace original.",
    );
  }

  const gitDir = path.join(canonicalWorkspaceRoot, ".git");
  if (!existsSync(gitDir)) {
    isolatedWorkInvalid("Diretório não é um repositório Git.");
  }

  mkdirSync(worktreesRoot, { recursive: true });

  const snapshotBefore = listWorkspaceFileContents(canonicalWorkspaceRoot);

  try {
    createIsolatedWorktreeInWorkspace({
      workspaceRoot: canonicalWorkspaceRoot,
      worktreePath: isolatedWorkspaceRoot,
      branchName: gitBranch,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao criar worktree isolado.";
    isolatedWorkInvalid(message);
  }

  const snapshotAfter = listWorkspaceFileContents(canonicalWorkspaceRoot);
  assertSnapshotsEqual(snapshotBefore, snapshotAfter);

  return {
    isolatedWorkId,
    canonicalWorkspaceRoot,
    isolatedWorkspaceRoot,
    gitBranch,
  };
}

/** Utilitário de teste/cleanup: remove worktree Git previamente criado. */
export function removeIsolatedGitWork(input: {
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
}): void {
  removeIsolatedWorktreeFromWorkspace({
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.isolatedWorkspaceRoot,
  });
}
