import type { McpStdioServerLaunch } from "@openagent/tools";
import type { McpHttpServerEndpoint } from "@openagent/tools";

export type McpServerConfig = McpStdioServerLaunch | McpHttpServerEndpoint;

export type McpServerTransportKind = "stdio" | "http";

export interface McpServerConfigInput {
  kind: McpServerTransportKind;
  serverId: string;
  command?: string;
  args?: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  authSecretRef?: string;
}

function normalizeInput(input: McpServerConfigInput): McpServerConfig {
  if (!input.serverId.trim()) {
    throw new Error("Identificador do servidor MCP inválido.");
  }

  if (input.kind === "stdio") {
    if (!input.command?.trim()) {
      throw new Error("Comando do servidor MCP stdio é obrigatório.");
    }
    return {
      serverId: input.serverId.trim(),
      command: input.command.trim(),
      args: (input.args ?? []).filter((a) => a.trim().length > 0),
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd.trim() } : {}),
      ...(input.authSecretRef !== undefined
        ? { authSecretRef: input.authSecretRef.trim() }
        : {}),
    } satisfies McpStdioServerLaunch;
  }

  if (input.kind === "http") {
    if (!input.url) {
      throw new Error("URL do servidor MCP HTTP é obrigatório.");
    }
    const parsed = new URL(input.url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL do servidor MCP HTTP deve usar http ou https.");
    }
    return {
      serverId: input.serverId.trim(),
      url: parsed.toString(),
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
      ...(input.authSecretRef !== undefined
        ? { authSecretRef: input.authSecretRef.trim() }
        : {}),
    } satisfies McpHttpServerEndpoint;
  }

  throw new Error(`Transporte MCP desconhecido: ${String(input.kind)}`);
}

export interface McpConfigViewSnapshot {
  kind: "form";
  html: string;
  accessible: {
    transport: McpServerTransportKind;
    serverId: string;
    command: string;
    url: string;
    authHint: string | null;
  };
}

export function buildMcpConfigView(
  input: McpServerConfigInput,
): McpConfigViewSnapshot {
  const config = normalizeInput(input);
  const transport = input.kind;
  const serverId = input.serverId.trim();

  const authHint: string | null =
    input.authSecretRef !== undefined
      ? "Autenticação via cofre do sistema"
      : null;

  const html = `<div data-testid="mcp-config-view">
    <div data-testid="mcp-config-transport" data-transport="${transport}">${
    transport === "stdio" ? "stdio" : "HTTP"
  }</div>
    <div data-testid="mcp-config-server-id" data-id="${serverId}">${serverId}</div>
    ${
      transport === "stdio"
        ? `<div data-testid="mcp-config-command">${(config as McpStdioServerLaunch).command}</div>`
        : `<div data-testid="mcp-config-url">${(config as McpHttpServerEndpoint).url}</div>`
    }
    ${authHint ? `<div data-testid="mcp-config-auth-hint">${authHint}</div>` : ""}
  </div>`;

  return {
    kind: "form",
    html,
    accessible: {
      transport,
      serverId,
      command: transport === "stdio" ? (config as McpStdioServerLaunch).command : "",
      url: transport === "http" ? (config as McpHttpServerEndpoint).url : "",
      authHint,
    },
  };
}
