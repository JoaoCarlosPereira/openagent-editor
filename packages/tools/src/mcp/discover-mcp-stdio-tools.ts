import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  parseMcpStdioServerLaunch,
  type McpStdioServerLaunch,
} from "./mcp-stdio-config.js";
import {
  resolveMcpStdioEnv,
  type McpAuthSecretResolver,
} from "./mcp-auth-material.js";

export interface DiscoveredMcpStdioTool {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

export interface McpStdioToolDiscoveryResult {
  serverId: string;
  transport: "stdio";
  tools: DiscoveredMcpStdioTool[];
}

function normalizeLaunch(input: McpStdioServerLaunch | unknown): McpStdioServerLaunch {
  return parseMcpStdioServerLaunch(input);
}

export type DiscoverMcpStdioToolsOptions = {
  resolveAuth?: McpAuthSecretResolver;
};

/**
 * Conecta a um servidor MCP stdio, executa discovery (`tools/list`) e encerra o processo.
 */
export async function discoverMcpStdioTools(
  input: McpStdioServerLaunch | unknown,
  options?: DiscoverMcpStdioToolsOptions,
): Promise<McpStdioToolDiscoveryResult> {
  const launch = normalizeLaunch(input);
  const env = await resolveMcpStdioEnv(launch, options);

  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env,
    cwd: launch.cwd,
    stderr: "ignore",
  });

  const client = new Client(
    { name: "openagent-tools", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const tools: DiscoveredMcpStdioTool[] = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? {},
    }));

    return {
      serverId: launch.serverId,
      transport: "stdio",
      tools,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
