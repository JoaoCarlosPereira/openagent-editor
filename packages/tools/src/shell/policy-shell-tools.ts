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
import {
  execWorkspaceCommand,
  type ExecWorkspaceCommandResult,
} from "./exec-workspace-command.js";

export interface PolicyShellToolContext {
  workspaceRoot: string;
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyShellExecInput {
  runId: string;
  sessionId: string;
  requestId: string;
  command: unknown;
}

function normalizeCommandForTarget(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Comando inválido.");
  }
  return raw.trim();
}

/**
 * AGT-03 + PER-01/PER-03: prepara execução shell com policy e sandbox.
 */
export function preparePolicyShellExec(
  flow: RunToolPermissionFlow,
  context: PolicyShellToolContext,
  input: PreparePolicyShellExecInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "shell.exec");
  const command = normalizeCommandForTarget(input.command);
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "shell.exec",
      target: { kind: "command", command },
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/** Executa comando após permissão concedida; captura stdout/stderr e código de saída. */
export function executePolicyShellExec(
  workspaceRoot: string,
  command: unknown,
): ExecWorkspaceCommandResult {
  return execWorkspaceCommand(workspaceRoot, command);
}

export interface AgentShellToolInvocationResult {
  capability: "shell.exec";
  tool: "shell.exec";
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * AGT-03: resultado tipado da ferramenta shell para exibição agrupada no painel do agente.
 */
export function formatAgentShellToolResult(
  execResult: ExecWorkspaceCommandResult,
): AgentShellToolInvocationResult {
  return {
    capability: "shell.exec",
    tool: "shell.exec",
    command: execResult.command,
    exitCode: execResult.exitCode,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    timedOut: execResult.timedOut,
  };
}
