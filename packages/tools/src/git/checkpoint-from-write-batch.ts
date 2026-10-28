import type { AgentFileWriteBatchResult } from "../files/agent-file-write-batch.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export type CheckpointWriteBatchHashes = {
  baseHashes: Record<string, string>;
  resultHashes: Record<string, string>;
};

/**
 * Deriva baseHashes/resultHashes dos arquivos aplicados num lote AGT-03 (somente paths alterados).
 */
export function buildCheckpointHashesFromAgentWriteBatch(
  batch: AgentFileWriteBatchResult,
): CheckpointWriteBatchHashes {
  const baseHashes: Record<string, string> = {};
  const resultHashes: Record<string, string> = {};

  for (const result of batch.results) {
    if (result.status !== "applied") {
      continue;
    }
    baseHashes[result.relativePath] = result.previousContentHashHex;
    resultHashes[result.relativePath] = result.newContentHashHex;
  }

  if (Object.keys(baseHashes).length === 0) {
    throw invalidToolInputError("Nenhuma alteração aplicada para checkpoint.");
  }

  return { baseHashes, resultHashes };
}
