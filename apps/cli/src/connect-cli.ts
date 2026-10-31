import {
  ensureHarnessDaemonReady,
  type EnsureHarnessDaemonOptions,
} from "@openagent/harness-daemon";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  connectHarnessClient,
  validateWorkspaceTransportHello,
  type HarnessClient,
  type WorkspaceTransportHello,
} from "@openagent/protocol";

export const OPENAGENT_CLI_CLIENT_ID = "openagent-cli";

export type OpenAgentCliConnectInput = {
  /** Handshake workspace.hello — configuração do workspace a reutilizar (CLI-01). */
  workspaceHello: unknown;
  dataRoot?: string;
  runtimeDirectory?: string;
  instanceId?: string;
  connectTimeoutMs?: number;
  spawnDaemon?: boolean;
  daemonEntry?: string;
  clientId?: string;
};

export type OpenAgentCliConnection = {
  client: HarnessClient;
  address: string;
  dataRoot: string;
  runtimeDirectory: string;
  workspaceHello: WorkspaceTransportHello;
};

/**
 * Inicia (sob demanda) o harness-daemon e conecta a CLI via HarnessClient (ADR-003 / CLI-01).
 * Entrada inválida falha com INVALID_STATE sem efeito colateral no daemon.
 */
export async function connectOpenAgentCli(
  input: OpenAgentCliConnectInput,
): Promise<OpenAgentCliConnection> {
  const validated = validateWorkspaceTransportHello(input.workspaceHello);
  if (!validated.valid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Handshake workspace.hello inválido para conexão da CLI.",
      validated.errors,
    );
  }

  const daemonOptions: EnsureHarnessDaemonOptions = {
    dataRoot: input.dataRoot,
    runtimeDirectory: input.runtimeDirectory,
    instanceId: input.instanceId,
    connectTimeoutMs: input.connectTimeoutMs,
    spawnDaemon: input.spawnDaemon,
    daemonEntry: input.daemonEntry,
  };

  const ready = await ensureHarnessDaemonReady(daemonOptions);
  const client = await connectHarnessClient({
    address: ready.address,
    workspaceHello: validated.value,
    clientId: input.clientId ?? OPENAGENT_CLI_CLIENT_ID,
  });

  return {
    client,
    address: ready.address,
    dataRoot: ready.dataRoot,
    runtimeDirectory: ready.runtimeDirectory,
    workspaceHello: validated.value,
  };
}
