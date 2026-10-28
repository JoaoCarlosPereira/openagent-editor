import { invalidToolInputError } from "../worker/tool-run-coordinator.js";

export type McpAuthMaterial = {
  kind: "bearer" | "oauth";
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  stdioEnv?: Record<string, string>;
};

export type McpAuthSecretResolver = (secretRef: string) => Promise<McpAuthMaterial | null>;

const SECRET_REF_PREFIX = "sysvault:";

export function assertMcpAuthSecretRef(secretRef: string): string {
  const trimmed = secretRef.trim();
  if (!trimmed.startsWith(SECRET_REF_PREFIX)) {
    throw invalidToolInputError("Referência de autenticação MCP inválida.");
  }
  return trimmed;
}

/**
 * Converte material do cofre em cabeçalhos HTTP para transporte MCP (MCP-01).
 */
export function mcpAuthMaterialToHttpHeaders(material: McpAuthMaterial): Record<string, string> {
  const tokenType = material.tokenType.trim() || "Bearer";
  return {
    Authorization: `${tokenType} ${material.accessToken}`,
  };
}

export async function resolveMcpHttpHeaders(
  endpoint: { headers?: Record<string, string>; authSecretRef?: string },
  options?: { resolveAuth?: McpAuthSecretResolver },
): Promise<Record<string, string>> {
  const merged: Record<string, string> = { ...(endpoint.headers ?? {}) };

  if (endpoint.authSecretRef === undefined) {
    return merged;
  }

  const secretRef = assertMcpAuthSecretRef(endpoint.authSecretRef);
  const resolver = options?.resolveAuth;
  if (!resolver) {
    throw invalidToolInputError(
      "Autenticação MCP requer resolução de secretRef via cofre do SO.",
    );
  }

  const material = await resolver(secretRef);
  if (!material) {
    throw invalidToolInputError("Autenticação MCP não encontrada no cofre.");
  }

  const authHeaders = mcpAuthMaterialToHttpHeaders(material);
  return { ...merged, ...authHeaders };
}

export async function resolveMcpStdioEnv(
  launch: { env?: Record<string, string>; authSecretRef?: string },
  options?: { resolveAuth?: McpAuthSecretResolver },
): Promise<Record<string, string> | undefined> {
  const base = launch.env ?? {};
  if (launch.authSecretRef === undefined) {
    return launch.env;
  }

  const secretRef = assertMcpAuthSecretRef(launch.authSecretRef);
  const resolver = options?.resolveAuth;
  if (!resolver) {
    throw invalidToolInputError(
      "Autenticação MCP requer resolução de secretRef via cofre do SO.",
    );
  }

  const material = await resolver(secretRef);
  if (!material) {
    throw invalidToolInputError("Autenticação MCP não encontrada no cofre.");
  }

  return { ...base, ...(material.stdioEnv ?? {}) };
}
