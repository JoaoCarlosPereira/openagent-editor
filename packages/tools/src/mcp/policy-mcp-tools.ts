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
import { executeMcpTool, type ExecuteMcpToolInput } from "./execute-mcp-tool.js";
import type { McpToolInvocationResult } from "./mcp-tool-invocation-result.js";

export interface PolicyMcpToolContext {
  agentMode: AgentMode;
  executionMode: ExecutionMode;
}

export interface PreparePolicyMcpToolInvokeInput {
  runId: string;
  sessionId: string;
  requestId: string;
  serverId: unknown;
  toolName: unknown;
}

function normalizeServerId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Identificador do servidor MCP inválido.");
  }
  return raw.trim();
}

function normalizeToolNameForPolicy(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Nome da ferramenta MCP inválido.");
  }
  return raw.trim();
}

function mcpPermissionTarget(serverId: string, toolName: string) {
  return {
    kind: "tool" as const,
    tool: "mcp",
    target: `${serverId}/${toolName}`,
  };
}

/**
 * MCP-01 + PER-01: prepara execução de ferramenta MCP externa com pedido de permissão explícito.
 */
export function preparePolicyMcpToolInvoke(
  flow: RunToolPermissionFlow,
  context: PolicyMcpToolContext,
  input: PreparePolicyMcpToolInvokeInput,
  sandboxOptions?: DescribeSandboxCapabilityOptions,
): SandboxToolDispatchPrepareResult {
  assertCapabilityAllowedForAgentMode(context.agentMode, "tool.invoke");
  const serverId = normalizeServerId(input.serverId);
  const toolName = normalizeToolNameForPolicy(input.toolName);
  return prepareSandboxToolDispatch(
    flow,
    {
      runId: input.runId,
      sessionId: input.sessionId,
      executionMode: context.executionMode,
      capability: "tool.invoke",
      target: mcpPermissionTarget(serverId, toolName),
      requestId: input.requestId,
    },
    sandboxOptions,
  );
}

/** Executa ferramenta MCP após aceite de permissão (PER-01). */
export async function executePolicyMcpToolInvoke(
  input: ExecuteMcpToolInput | unknown,
): Promise<McpToolInvocationResult> {
  return executeMcpTool(input);
}

export interface AgentMcpToolInvocationResult extends McpToolInvocationResult {
  capability: "tool.invoke";
  origin: "mcp";
}

/** Formata resultado para exibição agrupada no painel do agente (origem MCP + texto). */
export function formatAgentMcpToolResult(
  result: McpToolInvocationResult,
): AgentMcpToolInvocationResult {
  return {
    ...result,
    capability: "tool.invoke",
    origin: "mcp",
  };
}
