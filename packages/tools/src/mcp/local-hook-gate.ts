import {
  assertLocalHooksAllowAction,
  type LocalHookEngine,
} from "@openagent/policy";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export interface McpToolHookGateInput {
  runId: string;
  sessionId: string;
  serverId: string;
  toolName: string;
}

function normalizeSegment(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw invalidToolInputError(`${label} inválido.`);
  }
  return trimmed;
}

/**
 * CUS-03 + MCP-01: hooks locais podem negar invocação MCP antes da policy PER-01.
 */
export async function assertLocalHooksAllowMcpToolInvoke(
  engine: LocalHookEngine | undefined,
  input: McpToolHookGateInput,
): Promise<void> {
  if (!engine) {
    return;
  }
  const serverId = normalizeSegment(input.serverId, "serverId");
  const toolName = normalizeSegment(input.toolName, "toolName");
  await assertLocalHooksAllowAction(engine, {
    capability: "tool.invoke",
    target: { kind: "tool", tool: "mcp", target: `${serverId}/${toolName}` },
    runId: input.runId,
    sessionId: input.sessionId,
  });
}
