import { existsSync } from "node:fs";
import path from "node:path";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  applyWorkspaceFileWrite,
  snapshotWorkspaceFileForWrite,
  type FileWriteConflictResult,
} from "../files/write-workspace-file.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { runGitInWorkspace } from "./git-workspace-cli.mjs";
import {
  collectWorkspaceFileContents,
  removeIsolatedGitWork,
} from "./isolated-worktree.js";
import { sha256HexUtf8 } from "../files/file-content-hash.js";

export type IsolatedWorkDecision = "apply" | "discard";

export type IsolatedWorkApplyConflictEntry = {
  relativePath: string;
  expectedContentHashHex: string;
  currentContentHashHex: string;
  currentContent: string;
  proposedContent: string;
};

export type ApplyIsolatedGitWorkResult =
  | { applied: true; relativePaths: string[] }
  | { conflict: true; conflicts: IsolatedWorkApplyConflictEntry[] };

export type FinalizeIsolatedGitWorkResult =
  | ({ decision: "apply" } & ApplyIsolatedGitWorkResult)
  | { decision: "discard"; discarded: true };

function isolatedWorkInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function conflictFromWrite(conflict: FileWriteConflictResult): IsolatedWorkApplyConflictEntry {
  return {
    relativePath: conflict.relativePath,
    expectedContentHashHex: conflict.expectedContentHashHex,
    currentContentHashHex: conflict.currentContentHashHex,
    currentContent: conflict.currentContent,
    proposedContent: conflict.proposedContent,
  };
}

function assertWorkspaceRoots(workspaceRoot: string, isolatedWorkspaceRoot: string): {
  canonicalWorkspaceRoot: string;
  isolatedRoot: string;
} {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do workspace inválida.");
  }
  if (typeof isolatedWorkspaceRoot !== "string" || !isolatedWorkspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do worktree isolado inválida.");
  }

  const canonicalWorkspaceRoot = path.resolve(workspaceRoot.trim());
  const isolatedRoot = path.resolve(isolatedWorkspaceRoot.trim());

  if (!existsSync(path.join(canonicalWorkspaceRoot, ".git"))) {
    isolatedWorkInvalid("Diretório não é um repositório Git.");
  }
  if (!existsSync(isolatedRoot)) {
    isolatedWorkInvalid("Worktree isolado inexistente.", [isolatedRoot]);
  }

  return { canonicalWorkspaceRoot, isolatedRoot };
}

function readGitHeadFileContent(
  workspaceRoot: string,
  relativePath: string,
): string | null {
  const result = runGitInWorkspace(workspaceRoot, ["show", `HEAD:${relativePath}`]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

function assertSnapshotsEqual(
  before: Record<string, string>,
  after: Record<string, string>,
): void {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  if (beforeKeys.length !== afterKeys.length) {
    isolatedWorkInvalid("Operação alterou arquivos do workspace original indevidamente.");
  }
  for (let index = 0; index < beforeKeys.length; index += 1) {
    const key = beforeKeys[index] ?? "";
    if (afterKeys[index] !== key || after[key] !== before[key]) {
      isolatedWorkInvalid(
        "Operação alterou arquivos do workspace original indevidamente.",
        [key],
      );
    }
  }
}

/**
 * SES-04: copia alterações do worktree isolado para o workspace canônico (ERR-01 em conflito).
 */
export function applyIsolatedGitWork(input: {
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
}): ApplyIsolatedGitWorkResult {
  const { canonicalWorkspaceRoot, isolatedRoot } = assertWorkspaceRoots(
    input.workspaceRoot,
    input.isolatedWorkspaceRoot,
  );

  const isolatedFiles = collectWorkspaceFileContents(isolatedRoot);
  const canonicalFiles = collectWorkspaceFileContents(canonicalWorkspaceRoot);
  const relativePaths = Object.keys(isolatedFiles).sort();

  const pendingWrites: Array<{
    relativePath: string;
    expectedContentHashHex: string;
    newContent: string;
  }> = [];
  const conflicts: IsolatedWorkApplyConflictEntry[] = [];

  for (const relativePath of relativePaths) {
    const proposedContent = isolatedFiles[relativePath] ?? "";
    const canonicalContent = canonicalFiles[relativePath];
    if (canonicalContent === proposedContent) {
      continue;
    }
    const headContent = readGitHeadFileContent(canonicalWorkspaceRoot, relativePath);
    const headHash = sha256HexUtf8(headContent ?? "");
    const current = snapshotWorkspaceFileForWrite(canonicalWorkspaceRoot, relativePath);
    if (current.contentHashHex !== headHash) {
      conflicts.push({
        relativePath,
        expectedContentHashHex: headHash,
        currentContentHashHex: current.contentHashHex,
        currentContent: current.content,
        proposedContent,
      });
      continue;
    }
    pendingWrites.push({
      relativePath,
      expectedContentHashHex: current.contentHashHex,
      newContent: proposedContent,
    });
  }

  for (const write of pendingWrites) {
    const current = snapshotWorkspaceFileForWrite(canonicalWorkspaceRoot, write.relativePath);
    if (current.contentHashHex !== write.expectedContentHashHex) {
      conflicts.push({
        relativePath: write.relativePath,
        expectedContentHashHex: write.expectedContentHashHex,
        currentContentHashHex: current.contentHashHex,
        currentContent: current.content,
        proposedContent: write.newContent,
      });
    }
  }

  if (conflicts.length > 0) {
    return { conflict: true, conflicts };
  }

  for (const write of pendingWrites) {
    const outcome = applyWorkspaceFileWrite(canonicalWorkspaceRoot, write);
    if (outcome.status === "conflict") {
      return { conflict: true, conflicts: [conflictFromWrite(outcome)] };
    }
  }

  removeIsolatedGitWork({
    workspaceRoot: canonicalWorkspaceRoot,
    isolatedWorkspaceRoot: isolatedRoot,
  });

  return {
    applied: true,
    relativePaths: pendingWrites.map((entry) => entry.relativePath),
  };
}

/** SES-04: remove worktree isolado sem alterar o workspace canônico. */
export function discardIsolatedGitWork(input: {
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
}): { discarded: true } {
  const { canonicalWorkspaceRoot, isolatedRoot } = assertWorkspaceRoots(
    input.workspaceRoot,
    input.isolatedWorkspaceRoot,
  );

  const snapshotBefore = collectWorkspaceFileContents(canonicalWorkspaceRoot);
  removeIsolatedGitWork({
    workspaceRoot: canonicalWorkspaceRoot,
    isolatedWorkspaceRoot: isolatedRoot,
  });
  const snapshotAfter = collectWorkspaceFileContents(canonicalWorkspaceRoot);
  assertSnapshotsEqual(snapshotBefore, snapshotAfter);

  return { discarded: true };
}

/** SES-04: aplica escolhido ou descarta trabalho isolado via Git worktree. */
export function finalizeIsolatedGitWork(input: {
  decision: IsolatedWorkDecision;
  workspaceRoot: string;
  isolatedWorkspaceRoot: string;
}): FinalizeIsolatedGitWorkResult {
  if (input.decision !== "apply" && input.decision !== "discard") {
    isolatedWorkInvalid("Decisão de trabalho isolado inválida.");
  }

  if (input.decision === "discard") {
    discardIsolatedGitWork(input);
    return { decision: "discard", discarded: true };
  }

  const applied = applyIsolatedGitWork(input);
  if ("conflict" in applied) {
    return { decision: "apply", conflict: true, conflicts: applied.conflicts };
  }
  return {
    decision: "apply",
    applied: true,
    relativePaths: applied.relativePaths,
  };
}
