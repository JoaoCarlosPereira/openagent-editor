export interface McpToolContentBlock {
  type: string;
  text?: string;
}

/** Resultado observável de uma chamada MCP (`tools/call`) para exibição no produto (MCP-01). */
export interface McpToolInvocationResult {
  serverId: string;
  transport: "http" | "stdio";
  toolName: string;
  isError: boolean;
  content: readonly McpToolContentBlock[];
  structuredContent?: unknown;
}

export function primaryTextFromMcpToolInvocation(result: McpToolInvocationResult): string {
  for (const block of result.content) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return "";
}

function readCallToolPayload(result: unknown): {
  isError: boolean;
  content: readonly McpToolContentBlock[];
  structuredContent?: unknown;
} {
  if (typeof result !== "object" || result === null) {
    return { isError: false, content: [] };
  }
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record["content"])
    ? (record["content"] as McpToolContentBlock[])
    : [];
  return {
    isError: record["isError"] === true,
    content,
    ...(record["structuredContent"] !== undefined
      ? { structuredContent: record["structuredContent"] }
      : {}),
  };
}

export function mapCallToolResultToInvocation(input: {
  serverId: string;
  transport: "http" | "stdio";
  toolName: string;
  result: unknown;
}): McpToolInvocationResult {
  const payload = readCallToolPayload(input.result);
  return {
    serverId: input.serverId,
    transport: input.transport,
    toolName: input.toolName,
    isError: payload.isError,
    content: payload.content,
    ...(payload.structuredContent !== undefined
      ? { structuredContent: payload.structuredContent }
      : {}),
  };
}
