import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export interface McpStdioServerLaunch {
  serverId: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, entry]) => typeof key === "string" && typeof entry === "string",
  );
}

/**
 * Valida a configuração de spawn de um servidor MCP stdio (MCP-01).
 */
export function parseMcpStdioServerLaunch(input: unknown): McpStdioServerLaunch {
  if (typeof input !== "object" || input === null) {
    throw invalidToolInputError("Configuração MCP stdio inválida.");
  }

  const raw = input as Record<string, unknown>;

  if (!isNonEmptyString(raw.serverId)) {
    throw invalidToolInputError("Identificador do servidor MCP inválido.");
  }
  if (!isNonEmptyString(raw.command)) {
    throw invalidToolInputError("Comando do servidor MCP stdio inválido.");
  }

  let args: string[] = [];
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args) || !raw.args.every((entry) => typeof entry === "string")) {
      throw invalidToolInputError("Argumentos do servidor MCP stdio inválidos.");
    }
    args = raw.args;
  }

  if (raw.env !== undefined && !isStringRecord(raw.env)) {
    throw invalidToolInputError("Ambiente do servidor MCP stdio inválido.");
  }
  if (raw.cwd !== undefined && !isNonEmptyString(raw.cwd)) {
    throw invalidToolInputError("Diretório de trabalho do servidor MCP stdio inválido.");
  }

  return {
    serverId: raw.serverId.trim(),
    command: raw.command.trim(),
    args,
    ...(raw.env !== undefined ? { env: raw.env } : {}),
    ...(raw.cwd !== undefined ? { cwd: raw.cwd.trim() } : {}),
  };
}
