import { ProtocolError } from "@openagent/protocol";
import { formatSecretRef, mcpAuthAccount, parseSecretRef } from "./secret-ref.js";
import type { SystemSecretVault } from "./types.js";
import { OPENAGENT_SECRET_SERVICE } from "./types.js";

export type McpAuthKind = "bearer" | "oauth";

export type RegisterMcpAuthCredentialInput = {
  serverId: string;
  kind: McpAuthKind;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  /** Variáveis de ambiente injetadas em servidores MCP stdio (sem segredo em config). */
  stdioEnv?: Record<string, string>;
};

export type RegisterMcpAuthCredentialResult = {
  secretRef: string;
};

export type StoredMcpAuthCredential = {
  kind: McpAuthKind;
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  stdioEnv?: Record<string, string>;
};

function assertRegisterInput(input: RegisterMcpAuthCredentialInput): RegisterMcpAuthCredentialInput {
  const serverId = input.serverId?.trim();
  const accessToken = input.accessToken?.trim();
  const kind = input.kind;
  const details: string[] = [];
  if (!serverId) details.push("serverId");
  if (!accessToken) details.push("accessToken");
  if (kind !== "bearer" && kind !== "oauth") details.push("kind");
  if (input.stdioEnv !== undefined) {
    const valid =
      typeof input.stdioEnv === "object" &&
      input.stdioEnv !== null &&
      !Array.isArray(input.stdioEnv) &&
      Object.entries(input.stdioEnv).every(
        ([key, value]) => typeof key === "string" && typeof value === "string",
      );
    if (!valid) {
      details.push("stdioEnv");
    }
  }
  if (details.length > 0 || !serverId || !accessToken) {
    throw new ProtocolError(
      "INVALID_STATE",
      "Entrada de autenticação MCP incompleta ou inválida.",
      details,
    );
  }
  return {
    serverId,
    kind,
    accessToken,
    ...(input.refreshToken?.trim() ? { refreshToken: input.refreshToken.trim() } : {}),
    ...(input.tokenType?.trim() ? { tokenType: input.tokenType.trim() } : {}),
    ...(input.stdioEnv !== undefined ? { stdioEnv: input.stdioEnv } : {}),
  };
}

/**
 * MCP-01: persiste token/OAuth de servidor MCP no cofre do SO (somente secretRef fora do vault).
 */
export async function registerMcpAuthCredential(
  input: RegisterMcpAuthCredentialInput,
  options: { vault: SystemSecretVault },
): Promise<RegisterMcpAuthCredentialResult> {
  const normalized = assertRegisterInput(input);
  const payload: StoredMcpAuthCredential = {
    kind: normalized.kind,
    accessToken: normalized.accessToken,
    tokenType: normalized.tokenType ?? "Bearer",
    ...(normalized.refreshToken !== undefined ? { refreshToken: normalized.refreshToken } : {}),
    ...(normalized.stdioEnv !== undefined ? { stdioEnv: normalized.stdioEnv } : {}),
  };

  const account = mcpAuthAccount(normalized.serverId);
  await options.vault.store(
    OPENAGENT_SECRET_SERVICE,
    account,
    JSON.stringify(payload),
  );

  const secretRef = formatSecretRef(options.vault.backend, OPENAGENT_SECRET_SERVICE, account);
  return { secretRef };
}

export function createMcpAuthVaultResolver(vault: SystemSecretVault) {
  return async (secretRef: string): Promise<StoredMcpAuthCredential | null> =>
    readMcpAuthCredentialFromVault(secretRef, vault);
}

export async function readMcpAuthCredentialFromVault(
  secretRef: string,
  vault: SystemSecretVault,
): Promise<StoredMcpAuthCredential | null> {
  const parsed = parseSecretRef(secretRef);
  if (!parsed || parsed.backend !== vault.backend) {
    return null;
  }
  const raw = await vault.read(parsed.service, parsed.account);
  if (!raw) {
    return null;
  }
  try {
    const data = JSON.parse(raw) as Partial<StoredMcpAuthCredential>;
    if (!data.accessToken || (data.kind !== "bearer" && data.kind !== "oauth")) {
      return null;
    }
    return {
      kind: data.kind,
      accessToken: data.accessToken,
      tokenType: data.tokenType?.trim() || "Bearer",
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      ...(data.stdioEnv ? { stdioEnv: data.stdioEnv } : {}),
    };
  } catch {
    return null;
  }
}
