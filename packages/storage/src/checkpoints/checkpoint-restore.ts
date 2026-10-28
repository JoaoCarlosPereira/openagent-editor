import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  getStoredCheckpointById,
  readCheckpointHashesFromRef,
  readCheckpointPatchFromRef,
} from "./checkpoint-create.js";
import type { CheckpointFileHashes } from "./checkpoint-types.js";

export type LoadedCheckpointRestorePayload = {
  checkpointId: string;
  runId: string;
  baseHashes: CheckpointFileHashes;
  resultHashes: CheckpointFileHashes;
  patchText: string;
};

function checkpointInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

export function loadCheckpointRestorePayload(
  database: DatabaseSync,
  casRoot: string,
  checkpointId: unknown,
): LoadedCheckpointRestorePayload {
  if (typeof checkpointId !== "string" || !checkpointId.trim()) {
    checkpointInvalid("Campo 'checkpointId' ausente ou inválido.");
  }
  const id = checkpointId.trim();
  const stored = getStoredCheckpointById(database, id);
  if (!stored) {
    checkpointInvalid("Checkpoint inexistente.", [id]);
  }
  const record = stored;

  const baseHashes = readCheckpointHashesFromRef(database, casRoot, record.baseHashesRef);
  const resultHashes = readCheckpointHashesFromRef(database, casRoot, record.resultHashesRef);
  const patchText = readCheckpointPatchFromRef(database, casRoot, record.patchRef);

  return {
    checkpointId: record.checkpointId,
    runId: record.runId,
    baseHashes,
    resultHashes,
    patchText,
  };
}
