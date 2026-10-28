import fs from "node:fs";
import path from "node:path";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateWorkspaceTransportHello,
  type AgentMode,
  type Session,
  type WorkspaceBindingFacet,
  type WorkspaceTransportHello,
} from "@openagent/protocol";
import {
  connectOpenAgentCli,
  type OpenAgentCliConnectInput,
  type OpenAgentCliConnection,
} from "./connect-cli.js";

/** Facetas CLI-01 reutilizadas ao iniciar a CLI num workspace. */
export const OPENAGENT_CLI_WORKSPACE_REUSE_FACETS: readonly WorkspaceBindingFacet[] = [
  "provider",
  "mode",
  "rules",
  "mcp",
  "sessions",
] as const;

const AGENT_MODES = new Set<AgentMode>(["ask", "plan", "agent", "debug"]);

export type StartOpenAgentCliInWorkspaceInput = OpenAgentCliConnectInput & {
  /** Override opcional; por padrão reutiliza o mode do workspace (CLI-01). */
  sessionMode?: AgentMode;
};

export type OpenAgentCliWorkspaceReuseSnapshot = {
  providerProfileId: string;
  mode: AgentMode;
  rulesRef: string;
  mcpServerIds: readonly string[];
  sessionIds: readonly string[];
  loadedRules: Session["loadedRules"];
  facets: readonly WorkspaceBindingFacet[];
};

export type OpenAgentCliWorkspaceSession = {
  connection: OpenAgentCliConnection;
  session: Session;
  reused: OpenAgentCliWorkspaceReuseSnapshot;
};

function isAgentMode(value: string): value is AgentMode {
  return AGENT_MODES.has(value as AgentMode);
}

/**
 * Valida a raiz do workspace antes de tocar no daemon.
 * Entrada inválida → INVALID_STATE sem efeito colateral (CLI-01).
 */
export function assertOpenAgentCliWorkspaceRoot(workspaceRoot: unknown): string {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceRoot inválido para iniciar a CLI no workspace.",
      ["Campo obrigatório 'workspaceRoot' ausente ou inválido."],
    );
  }

  const resolved = path.resolve(workspaceRoot.trim());
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceRoot inexistente para iniciar a CLI no workspace.",
      [`Diretório inexistente: ${resolved}`],
    );
  }

  if (!stats.isDirectory()) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceRoot não é um diretório.",
      [`Caminho não é diretório: ${resolved}`],
    );
  }

  return resolved;
}

function resolveValidatedHello(workspaceHello: unknown): WorkspaceTransportHello {
  const validated = validateWorkspaceTransportHello(workspaceHello);
  if (!validated.valid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Handshake workspace.hello inválido para iniciar a CLI no workspace.",
      validated.errors,
    );
  }
  const resolvedRoot = assertOpenAgentCliWorkspaceRoot(validated.value.workspaceRoot);
  return {
    ...validated.value,
    workspaceRoot: resolvedRoot,
  };
}

function resolveSessionMode(
  bindingMode: string,
  sessionMode: AgentMode | undefined,
): AgentMode {
  if (sessionMode) {
    return sessionMode;
  }
  return isAgentMode(bindingMode) ? bindingMode : "agent";
}

function mergeUniqueIds(...groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const id of group) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  return merged;
}

function buildReuseSnapshot(
  hello: WorkspaceTransportHello,
  connection: OpenAgentCliConnection,
  session: Session,
): OpenAgentCliWorkspaceReuseSnapshot {
  const binding = connection.client.binding;
  return {
    providerProfileId: binding.providerProfileId,
    mode: session.mode,
    rulesRef: session.rulesRef || binding.rulesRef || hello.rulesRef,
    mcpServerIds: [...binding.mcpServerIds],
    // sessionIds do ack + sessão recém-criada (daemon atualiza o binding server-side).
    sessionIds: mergeUniqueIds(binding.sessionIds, session.sessionIds, [session.sessionId]),
    loadedRules: session.loadedRules,
    facets: OPENAGENT_CLI_WORKSPACE_REUSE_FACETS,
  };
}

/**
 * Inicia a CLI num workspace e reutiliza provedor, modo, regras, MCP e sessões (CLI-01).
 * Orquestra connectOpenAgentCli + session.create com o mode do workspace.
 */
export async function startOpenAgentCliInWorkspace(
  input: StartOpenAgentCliInWorkspaceInput,
): Promise<OpenAgentCliWorkspaceSession> {
  const workspaceHello = resolveValidatedHello(input.workspaceHello);

  const connection = await connectOpenAgentCli({
    ...input,
    workspaceHello,
  });

  try {
    const mode = resolveSessionMode(connection.client.binding.mode, input.sessionMode);
    const session = await connection.client.createSession({ mode });
    const reused = buildReuseSnapshot(workspaceHello, connection, session);

    return { connection, session, reused };
  } catch (error) {
    connection.client.close();
    throw error;
  }
}
