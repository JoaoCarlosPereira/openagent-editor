import path from "node:path";

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
import { dispatchInIsolatedWorker } from "../worker/isolated-worker-thread.js";
import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export const GIT_WORKER_TOOL_NAMES = ["gitStatus", "gitDiff"] as const;
export type GitWorkerToolName = (typeof GIT_WORKER_TOOL_NAMES)[number];

export interface GitCliCaptureResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GitDiffWorkerResult extends GitCliCaptureResult {
  relativePath: string | null;
}

export interface PolicyGitToolContext {
  workspaceRoot: string;
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyGitStatusInput {
  runId: string;
  sessionId: string;
  requestId: string;
}

export interface PreparePolicyGitDiffInput {
  runId: string;
  sessionId: string;
  requestId: string;
  relativePath?: unknown;
}

function normalizeOptionalRelativePath(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  return trimmed;
}

/**
 * AGT-03 + PER-01: prepara git status com policy (leitura, permitido em Somente leitura).
 */
export function preparePolicyGitStatus(
  flow: RunToolPermissionFlow,
  context: PolicyGitToolContext,
  input: PreparePolicyGitStatusInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "git.status");
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "git.status",
      target: { kind: "command", command: "git status" },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/**
 * AGT-03 + PER-01: prepara git diff com policy (leitura).
 */
export function preparePolicyGitDiff(
  flow: RunToolPermissionFlow,
  context: PolicyGitToolContext,
  input: PreparePolicyGitDiffInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "git.diff");
  const relativePath = normalizeOptionalRelativePath(input.relativePath);
  const diffCommand = relativePath ? `git diff -- ${relativePath}` : "git diff";
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "git.diff",
      target: { kind: "command", command: diffCommand },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/** Executa git status no worker isolado (Git CLI do sistema). */
export async function executePolicyGitStatusInWorker(
  workspaceRoot: string,
): Promise<GitCliCaptureResult> {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do workspace inválida.");
  }
  const output = (await dispatchInIsolatedWorker(
    "gitStatus",
    { workspaceRoot: workspaceRoot.trim() },
    GIT_WORKER_TOOL_NAMES,
  )) as GitCliCaptureResult;
  return output;
}

/** Executa git diff no worker isolado. */
export async function executePolicyGitDiffInWorker(
  workspaceRoot: string,
  relativePath?: unknown,
): Promise<GitDiffWorkerResult> {
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    throw invalidToolInputError("Raiz do workspace inválida.");
  }
  const pathArg = normalizeOptionalRelativePath(relativePath);
  const output = (await dispatchInIsolatedWorker(
    "gitDiff",
    {
      workspaceRoot: workspaceRoot.trim(),
      ...(pathArg ? { relativePath: pathArg } : {}),
    },
    GIT_WORKER_TOOL_NAMES,
  )) as GitDiffWorkerResult;
  return output;
}

export interface AgentGitStatusToolInvocationResult {
  capability: "git.status";
  tool: "git.status";
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface AgentGitDiffToolInvocationResult {
  capability: "git.diff";
  tool: "git.diff";
  command: string;
  relativePath: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export function formatAgentGitStatusToolResult(
  result: GitCliCaptureResult,
): AgentGitStatusToolInvocationResult {
  return {
    capability: "git.status",
    tool: "git.status",
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export function formatAgentGitDiffToolResult(
  result: GitDiffWorkerResult,
): AgentGitDiffToolInvocationResult {
  return {
    capability: "git.diff",
    tool: "git.diff",
    command: result.command,
    relativePath: result.relativePath,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}
