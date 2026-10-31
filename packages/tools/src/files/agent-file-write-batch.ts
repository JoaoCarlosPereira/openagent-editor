import type { AgentMode } from "@openagent/protocol";
import { assertCapabilityAllowedForAgentMode } from "@openagent/policy";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import {
  applyWorkspaceFileWrite,
  type FileWriteAppliedResult,
  type FileWriteConflictResult,
  type WriteWorkspaceFileResult,
} from "./write-workspace-file.js";

export interface AgentFileWriteOperation {
  relativePath: string;
  expectedContentHashHex: string;
  newContent: string;
}

export type AgentFileWriteOperationResult = WriteWorkspaceFileResult;

export interface AgentFileWriteBatchResult {
  agentMode: AgentMode;
  results: AgentFileWriteOperationResult[];
  groupedDiff: string;
}

function assertAgentModeForWrite(agentMode: AgentMode): void {
  assertCapabilityAllowedForAgentMode(agentMode, "file.write");
  if (agentMode !== "agent" && agentMode !== "plan") {
    throw invalidToolInputError("Escrita em lote AGT-03 exige modo Agent ou Plan.");
  }
}

function validateOperations(raw: unknown): AgentFileWriteOperation[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw invalidToolInputError("Operações de escrita inválidas.");
  }
  const operations: AgentFileWriteOperation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw invalidToolInputError("Operações de escrita inválidas.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.relativePath !== "string" ||
      typeof record.expectedContentHashHex !== "string" ||
      typeof record.newContent !== "string"
    ) {
      throw invalidToolInputError("Operações de escrita inválidas.");
    }
    operations.push({
      relativePath: record.relativePath,
      expectedContentHashHex: record.expectedContentHashHex,
      newContent: record.newContent,
    });
  }
  return operations;
}

/**
 * AGT-03: aplica várias escritas no modo Agent e agrega diff + resultado por arquivo.
 */
export function executeAgentFileWriteBatch(
  workspaceRoot: string,
  agentMode: AgentMode,
  operationsInput: unknown,
): AgentFileWriteBatchResult {
  assertAgentModeForWrite(agentMode);
  const operations = validateOperations(operationsInput);
  const results: AgentFileWriteOperationResult[] = [];

  for (const operation of operations) {
    results.push(
      applyWorkspaceFileWrite(workspaceRoot, {
        relativePath: operation.relativePath,
        expectedContentHashHex: operation.expectedContentHashHex,
        newContent: operation.newContent,
      }),
    );
  }

  const diffParts = results
    .filter((result): result is FileWriteAppliedResult => result.status === "applied")
    .map((result) => result.diffSummary);

  const groupedDiff =
    diffParts.length > 0 ? diffParts.join("\n\n") : "Nenhuma alteração aplicada.";

  return {
    agentMode,
    results,
    groupedDiff,
  };
}

export function summarizeAgentFileWriteBatch(batch: AgentFileWriteBatchResult): {
  appliedCount: number;
  conflictCount: number;
  conflicts: FileWriteConflictResult[];
} {
  const conflicts = batch.results.filter(
    (result): result is FileWriteConflictResult => result.status === "conflict",
  );
  return {
    appliedCount: batch.results.length - conflicts.length,
    conflictCount: conflicts.length,
    conflicts,
  };
}
