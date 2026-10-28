import type { AgentMode } from "@openagent/protocol";
import {
  assertCapabilityAllowedForAgentMode,
  RunToolPermissionFlow,
  type ExecutionMode,
} from "@openagent/policy";

import type { DescribeSandboxCapabilityOptions } from "../sandbox/sandbox-capability.js";
import {
  prepareSandboxToolDispatch,
  type SandboxToolDispatchPrepareResult,
} from "../sandbox/tool-sandbox-dispatch.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { readWorkspaceFile, type ReadWorkspaceFileResult } from "./read-workspace-file.js";
import {
  searchWorkspaceFiles,
  type SearchWorkspaceFilesResult,
} from "./search-workspace-files.js";

export interface PolicyFileToolContext {
  workspaceRoot: string;
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyFileReadInput {
  runId: string;
  sessionId: string;
  requestId: string;
  relativePath: unknown;
}

export interface PreparePolicyFileSearchInput {
  runId: string;
  sessionId: string;
  requestId: string;
  query: unknown;
}

function normalizeRelativePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  return raw.trim();
}

function normalizeSearchQueryForTarget(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Consulta vazia.");
  }
  return raw.trim();
}

/**
 * AGT-01 + PER-01/PER-03: prepara leitura de arquivo com policy e sandbox.
 */
export function preparePolicyFileRead(
  flow: RunToolPermissionFlow,
  context: PolicyFileToolContext,
  input: PreparePolicyFileReadInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "file.read");
  const relativePath = normalizeRelativePath(input.relativePath);
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "file.read",
      target: { kind: "path", path: relativePath },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/**
 * Executa leitura após permissão concedida (ERR-02 aplicado na resolução de caminho).
 */
export function executePolicyFileRead(
  workspaceRoot: string,
  relativePath: unknown,
): ReadWorkspaceFileResult {
  return readWorkspaceFile(workspaceRoot, normalizeRelativePath(relativePath));
}

/**
 * AGT-01 + PER-01/PER-03: prepara busca textual com policy e sandbox.
 */
export function preparePolicyFileSearch(
  flow: RunToolPermissionFlow,
  context: PolicyFileToolContext,
  input: PreparePolicyFileSearchInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "file.search");
  const query = normalizeSearchQueryForTarget(input.query);
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "file.search",
      target: { kind: "resource", label: query },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/** Executa busca após permissão concedida (somente leitura; sem mutação). */
export function executePolicyFileSearch(
  workspaceRoot: string,
  query: unknown,
): SearchWorkspaceFilesResult {
  return searchWorkspaceFiles(workspaceRoot, query);
}
