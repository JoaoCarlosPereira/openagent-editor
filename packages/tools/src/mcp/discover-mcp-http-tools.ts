import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  parseMcpHttpServerEndpoint,
  type McpHttpServerEndpoint,
} from "./mcp-http-config.js";

export interface DiscoveredMcpHttpTool {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

export interface McpHttpToolDiscoveryResult {
  serverId: string;
  transport: "http";
  tools: DiscoveredMcpHttpTool[];
}

function normalizeEndpoint(input: McpHttpServerEndpoint | unknown): McpHttpServerEndpoint {
  return parseMcpHttpServerEndpoint(input);
}

/**
 * Conecta a um servidor MCP HTTP (Streamable HTTP), executa discovery (`tools/list`) e encerra a sessão.
 */
export async function discoverMcpHttpTools(
  input: McpHttpServerEndpoint | unknown,
): Promise<McpHttpToolDiscoveryResult> {
  const endpoint = normalizeEndpoint(input);
  const url = new URL(endpoint.url);

  const transport = new StreamableHTTPClientTransport(url, {
    ...(endpoint.headers !== undefined
      ? { requestInit: { headers: endpoint.headers } }
      : {}),
  });

  const client = new Client(
    { name: "openagent-tools", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools: DiscoveredMcpHttpTool[] = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? {},
    }));

    return {
      serverId: endpoint.serverId,
      transport: "http",
      tools,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
