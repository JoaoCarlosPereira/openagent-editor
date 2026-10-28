import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export interface McpHttpServerEndpoint {
  serverId: string;
  url: string;
  headers?: Record<string, string>;
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

function parseHttpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw invalidToolInputError("URL do servidor MCP HTTP inválida.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidToolInputError("URL do servidor MCP HTTP deve usar http ou https.");
  }
  return parsed.toString();
}

/**
 * Valida a configuração de um endpoint MCP HTTP (MCP-01).
 */
export function parseMcpHttpServerEndpoint(input: unknown): McpHttpServerEndpoint {
  if (typeof input !== "object" || input === null) {
    throw invalidToolInputError("Configuração MCP HTTP inválida.");
  }

  const raw = input as Record<string, unknown>;

  if (!isNonEmptyString(raw.serverId)) {
    throw invalidToolInputError("Identificador do servidor MCP inválido.");
  }
  if (!isNonEmptyString(raw.url)) {
    throw invalidToolInputError("URL do servidor MCP HTTP inválida.");
  }
  if (raw.headers !== undefined && !isStringRecord(raw.headers)) {
    throw invalidToolInputError("Cabeçalhos do servidor MCP HTTP inválidos.");
  }

  return {
    serverId: raw.serverId.trim(),
    url: parseHttpUrl(raw.url),
    ...(raw.headers !== undefined ? { headers: raw.headers } : {}),
  };
}
