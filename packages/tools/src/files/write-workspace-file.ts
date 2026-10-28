import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { conflictError, ProtocolError } from "@openagent/protocol";
import { resolveCanonicalWorkspacePath } from "@openagent/policy";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { isSha256Hex, sha256HexUtf8 } from "./file-content-hash.js";

export const FILE_WRITE_CONFLICT_MESSAGE =
  "Conflito de versão: o arquivo mudou desde a geração da edição." as const;

export interface WorkspaceFileSnapshot {
  relativePath: string;
  content: string;
  contentHashHex: string;
  exists: boolean;
}

export interface FileWriteAppliedResult {
  status: "applied";
  relativePath: string;
  previousContentHashHex: string;
  newContentHashHex: string;
  diffSummary: string;
}

export interface FileWriteConflictResult {
  status: "conflict";
  relativePath: string;
  expectedContentHashHex: string;
  currentContentHashHex: string;
  currentContent: string;
  proposedContent: string;
}

export type WriteWorkspaceFileResult = FileWriteAppliedResult | FileWriteConflictResult;

function assertRelativeFilePath(relativePath: unknown): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  const normalized = relativePath.trim();
  if (path.isAbsolute(normalized)) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  return normalized;
}

function readSnapshot(workspaceRoot: string, relativePath: string): WorkspaceFileSnapshot {
  const resolved = resolveCanonicalWorkspacePath(workspaceRoot, relativePath);
  if (!resolved.ok) {
    throw resolved.error;
  }

  try {
    const stat = statSync(resolved.canonicalPath);
    if (!stat.isFile()) {
      throw invalidToolInputError("O caminho não aponta para um arquivo.");
    }
    const content = readFileSync(resolved.canonicalPath, "utf8");
    return {
      relativePath,
      content,
      contentHashHex: sha256HexUtf8(content),
      exists: true,
    };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return {
        relativePath,
        content: "",
        contentHashHex: sha256HexUtf8(""),
        exists: false,
      };
    }
    if (error instanceof ProtocolError) {
      throw error;
    }
    throw invalidToolInputError("O caminho não aponta para um arquivo.");
  }
}

/** Snapshot usado na geração da edição (hash base para ERR-01). */
export function snapshotWorkspaceFileForWrite(
  workspaceRoot: string,
  relativePath: unknown,
): WorkspaceFileSnapshot {
  return readSnapshot(workspaceRoot, assertRelativeFilePath(relativePath));
}

function buildDiffSummary(before: string, after: string, relativePath: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

export interface ApplyWorkspaceFileWriteInput {
  relativePath: unknown;
  expectedContentHashHex: unknown;
  newContent: unknown;
}

export function applyWorkspaceFileWrite(
  workspaceRoot: string,
  input: ApplyWorkspaceFileWriteInput,
): WriteWorkspaceFileResult {
  const relativePath = assertRelativeFilePath(input.relativePath);
  if (!isSha256Hex(input.expectedContentHashHex)) {
    throw invalidToolInputError("Hash esperado inválido (SHA-256 hex).");
  }
  if (typeof input.newContent !== "string") {
    throw invalidToolInputError("Conteúdo de escrita inválido.");
  }

  const expectedContentHashHex = input.expectedContentHashHex.trim().toLowerCase();
  const proposedContent = input.newContent;
  const current = readSnapshot(workspaceRoot, relativePath);

  if (current.contentHashHex !== expectedContentHashHex) {
    return {
      status: "conflict",
      relativePath,
      expectedContentHashHex,
      currentContentHashHex: current.contentHashHex,
      currentContent: current.content,
      proposedContent,
    };
  }

  const resolved = resolveCanonicalWorkspacePath(workspaceRoot, relativePath);
  if (!resolved.ok) {
    throw resolved.error;
  }

  writeFileSync(resolved.canonicalPath, proposedContent, "utf8");
  const newContentHashHex = sha256HexUtf8(proposedContent);

  return {
    status: "applied",
    relativePath,
    previousContentHashHex: expectedContentHashHex,
    newContentHashHex,
    diffSummary: buildDiffSummary(current.content, proposedContent, relativePath),
  };
}

/** Converte conflito ERR-01 em erro de protocolo estável. */
export function fileWriteConflictProtocolError(
  conflict: FileWriteConflictResult,
): ProtocolError {
  return conflictError(FILE_WRITE_CONFLICT_MESSAGE, [
    FILE_WRITE_CONFLICT_MESSAGE,
    JSON.stringify({
      path: conflict.relativePath,
      expectedContentHashHex: conflict.expectedContentHashHex,
      currentContentHashHex: conflict.currentContentHashHex,
      currentContent: conflict.currentContent,
      proposedContent: conflict.proposedContent,
    }),
  ]);
}
