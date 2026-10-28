import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { sha256HexUtf8 } from "../files/file-content-hash.js";
import {
  applyWorkspaceFileWrite,
  snapshotWorkspaceFileForWrite,
} from "../files/write-workspace-file.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { parseCheckpointPatchText } from "./checkpoint-patch.js";

export type CheckpointRestoreInput = {
  baseHashes: Record<string, string>;
  resultHashes: Record<string, string>;
  patchText: string;
};

export type CheckpointRestoreResult =
  | { restored: true }
  | { conflict: true };

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

/**
 * SES-03: reverte somente arquivos marcados no checkpoint, sem sobrescrever edição manual divergente.
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
    if (!entry) {
      continue;
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
    const current = snapshotWorkspaceFileForWrite(workspaceRoot, relativePath);
    if (current.contentHashHex !== resultHash) {
      return { conflict: true };
    }
    if (current.contentHashHex === baseHashes[relativePath]) {
      continue;
    }
    pendingWrites.push({
      relativePath,
      expectedContentHashHex: resultHash,
      newContent: entry.baseContent,
    });
  }

  for (const write of pendingWrites) {
    const outcome = applyWorkspaceFileWrite(workspaceRoot, write);
    if (outcome.status === "conflict") {
      return { conflict: true };
    }
  }

  return { restored: true };
}
