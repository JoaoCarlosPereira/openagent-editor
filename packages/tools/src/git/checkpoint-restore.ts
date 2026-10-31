import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { sha256HexUtf8 } from "../files/file-content-hash.js";
import {
  applyWorkspaceFileWrite,
  snapshotWorkspaceFileForWrite,
  type FileWriteConflictResult,
} from "../files/write-workspace-file.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { parseCheckpointPatchText } from "./checkpoint-patch.js";

export type CheckpointRestoreConflictEntry = {
  relativePath: string;
  expectedContentHashHex: string;
  currentContentHashHex: string;
  currentContent: string;
  proposedContent: string;
};

export type CheckpointRestoreInput = {
  baseHashes: Record<string, string>;
  resultHashes: Record<string, string>;
  patchText: string;
};

export type CheckpointRestoreResult =
  | { restored: true }
  | { conflict: true; conflicts: CheckpointRestoreConflictEntry[] };

function checkpointInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function normalizeHashMap(raw: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key.trim()] = value.trim().toLowerCase();
  }
  return normalized;
}

function assertHashMapsAlign(
  baseHashes: Record<string, string>,
  resultHashes: Record<string, string>,
): void {
  const baseKeys = new Set(Object.keys(baseHashes));
  const resultKeys = new Set(Object.keys(resultHashes));
  if (baseKeys.size !== resultKeys.size) {
    checkpointInvalid(
      "Hashes de checkpoint inconsistentes: arquivos da execução não coincidem.",
    );
  }
  for (const key of baseKeys) {
    if (!resultKeys.has(key)) {
      checkpointInvalid(
        "Hashes de checkpoint inconsistentes: arquivos da execução não coincidem.",
        [key],
      );
    }
  }
}

function conflictEntryFromWriteConflict(
  conflict: FileWriteConflictResult,
): CheckpointRestoreConflictEntry {
  return {
    relativePath: conflict.relativePath,
    expectedContentHashHex: conflict.expectedContentHashHex,
    currentContentHashHex: conflict.currentContentHashHex,
    currentContent: conflict.currentContent,
    proposedContent: conflict.proposedContent,
  };
}

function conflictEntryFromDrift(input: {
  relativePath: string;
  expectedContentHashHex: string;
  currentContent: string;
  currentContentHashHex: string;
  proposedContent: string;
}): CheckpointRestoreConflictEntry {
  return {
    relativePath: input.relativePath,
    expectedContentHashHex: input.expectedContentHashHex,
    currentContentHashHex: input.currentContentHashHex,
    currentContent: input.currentContent,
    proposedContent: input.proposedContent,
  };
}

/**
 * SES-03 / ERR-01: reverte só arquivos do run; conflito expõe as duas versões sem gravar por cima.
 */
export function restoreCheckpointOnWorkspace(
  workspaceRoot: string,
  input: CheckpointRestoreInput,
): CheckpointRestoreResult {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do workspace inválida.");
  }

  const baseHashes = normalizeHashMap(input.baseHashes);
  const resultHashes = normalizeHashMap(input.resultHashes);
  assertHashMapsAlign(baseHashes, resultHashes);

  let parsed;
  try {
    parsed = parseCheckpointPatchText(input.patchText);
  } catch {
    checkpointInvalid("Patch de checkpoint inválido ou incompleto para restauração.");
  }

  const parsedByPath = new Map(parsed.map((entry) => [entry.relativePath, entry]));
  const runPaths = Object.keys(resultHashes).sort();

  if (parsedByPath.size !== runPaths.length) {
    checkpointInvalid("Patch de checkpoint não cobre os arquivos marcados da execução.");
  }

  for (const relativePath of runPaths) {
    const entry = parsedByPath.get(relativePath);
    if (!entry) {
      checkpointInvalid("Patch de checkpoint não cobre os arquivos marcados da execução.", [
        relativePath,
      ]);
    }
    const baseHash = baseHashes[relativePath];
    const resultHash = resultHashes[relativePath];
    if (sha256HexUtf8(entry.baseContent) !== baseHash) {
      checkpointInvalid("Patch de checkpoint inconsistente com baseHashes.", [relativePath]);
    }
    if (sha256HexUtf8(entry.resultContent) !== resultHash) {
      checkpointInvalid("Patch de checkpoint inconsistente com resultHashes.", [relativePath]);
    }
  }

  const conflicts: CheckpointRestoreConflictEntry[] = [];
  const pendingWrites: Array<{
    relativePath: string;
    expectedContentHashHex: string;
    newContent: string;
  }> = [];

  for (const relativePath of runPaths) {
    const entry = parsedByPath.get(relativePath);
    if (!entry) {
      continue;
    }
    const resultHash = resultHashes[relativePath] ?? "";
    const baseHash = baseHashes[relativePath] ?? "";
    const current = snapshotWorkspaceFileForWrite(workspaceRoot, relativePath);

    if (current.contentHashHex !== resultHash) {
      conflicts.push(
        conflictEntryFromDrift({
          relativePath,
          expectedContentHashHex: resultHash,
          currentContent: current.content,
          currentContentHashHex: current.contentHashHex,
          proposedContent: entry.baseContent,
        }),
      );
      continue;
    }

    if (current.contentHashHex === baseHash) {
      continue;
    }

    pendingWrites.push({
      relativePath,
      expectedContentHashHex: resultHash,
      newContent: entry.baseContent,
    });
  }

  if (conflicts.length > 0) {
    return { conflict: true, conflicts };
  }

  for (const write of pendingWrites) {
    const snap = snapshotWorkspaceFileForWrite(workspaceRoot, write.relativePath);
    if (snap.contentHashHex !== write.expectedContentHashHex) {
      const entry = parsedByPath.get(write.relativePath);
      conflicts.push(
        conflictEntryFromDrift({
          relativePath: write.relativePath,
          expectedContentHashHex: write.expectedContentHashHex,
          currentContent: snap.content,
          currentContentHashHex: snap.contentHashHex,
          proposedContent: entry?.baseContent ?? write.newContent,
        }),
      );
    }
  }

  if (conflicts.length > 0) {
    return { conflict: true, conflicts };
  }

  for (const write of pendingWrites) {
    const outcome = applyWorkspaceFileWrite(workspaceRoot, write);
    if (outcome.status === "conflict") {
      conflicts.push(conflictEntryFromWriteConflict(outcome));
      return { conflict: true, conflicts };
    }
  }

  return { restored: true };
}
