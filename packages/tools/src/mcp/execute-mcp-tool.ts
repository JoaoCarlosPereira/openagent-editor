import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import {
  parseMcpHttpServerEndpoint,
  type McpHttpServerEndpoint,
} from "./mcp-http-config.js";
import {
  parseMcpStdioServerLaunch,
  type McpStdioServerLaunch,
} from "./mcp-stdio-config.js";
import {
  mapCallToolResultToInvocation,
  type McpToolInvocationResult,
} from "./mcp-tool-invocation-result.js";

export interface ExecuteMcpHttpToolInput {
  transport: "http";
  server: McpHttpServerEndpoint | unknown;
  toolName: unknown;
  arguments?: unknown;
}

export interface ExecuteMcpStdioToolInput {
  transport: "stdio";
  server: McpStdioServerLaunch | unknown;
  toolName: unknown;
  arguments?: unknown;
}

export type ExecuteMcpToolInput = ExecuteMcpHttpToolInput | ExecuteMcpStdioToolInput;

function normalizeToolName(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw invalidToolInputError("Nome da ferramenta MCP inválido.");
  }
  return raw.trim();
}

function normalizeToolArguments(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw invalidToolInputError("Argumentos da ferramenta MCP inválidos.");
  }
  return raw as Record<string, unknown>;
}

function assertTransport(raw: unknown): "http" | "stdio" {
  if (raw === "http" || raw === "stdio") {
    return raw;
  }
  throw invalidToolInputError("Transporte MCP inválido.");
}

async function invokeWithClient(
  client: Client,
  input: {
    serverId: string;
    transport: "http" | "stdio";
    toolName: string;
    toolArguments: Record<string, unknown> | undefined;
  },
): Promise<McpToolInvocationResult> {
  const result = await client.callTool({
    name: input.toolName,
    arguments: input.toolArguments,
  });
  return mapCallToolResultToInvocation({
    serverId: input.serverId,
    transport: input.transport,
    toolName: input.toolName,
    result,
  });
}

/**
 * Executa `tools/call` em servidor MCP HTTP ou stdio e devolve resultado ou erro da ferramenta (MCP-01).
 */
export async function executeMcpTool(input: ExecuteMcpToolInput | unknown): Promise<McpToolInvocationResult> {
  if (typeof input !== "object" || input === null) {
    throw invalidToolInputError("Pedido de execução MCP inválido.");
  }
  const raw = input as Record<string, unknown>;
  const transport = assertTransport(raw["transport"]);
  const toolName = normalizeToolName(raw["toolName"]);
  const toolArguments = normalizeToolArguments(raw["arguments"]);

  if (transport === "http") {
    const endpoint = parseMcpHttpServerEndpoint(raw["server"]);
    const url = new URL(endpoint.url);
    const httpTransport = new StreamableHTTPClientTransport(url, {
      ...(endpoint.headers !== undefined
        ? { requestInit: { headers: endpoint.headers } }
        : {}),
    });
    const client = new Client(
      { name: "openagent-tools", version: "0.1.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(httpTransport);
      return await invokeWithClient(client, {
        serverId: endpoint.serverId,
        transport: "http",
        toolName,
        toolArguments,
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  const launch = parseMcpStdioServerLaunch(raw["server"]);
  const stdioTransport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: launch.env,
    cwd: launch.cwd,
    stderr: "ignore",
  });
  const client = new Client(
    { name: "openagent-tools", version: "0.1.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(stdioTransport);
    return await invokeWithClient(client, {
      serverId: launch.serverId,
      transport: "stdio",
      toolName,
      toolArguments,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}
