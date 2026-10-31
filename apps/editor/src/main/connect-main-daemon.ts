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

export const OPENAGENT_EDITOR_MAIN_CLIENT_ID = "openagent-editor-main";

export const EDITOR_MAIN_HELLO_INVALID_MESSAGE =
  "Handshake workspace.hello inválido para conexão do processo main do editor.";

export type OpenAgentEditorMainConnectInput = {
  /** Handshake workspace.hello — binding do workspace no daemon (ADR-003 / LOC-01). */
  workspaceHello: unknown;
  dataRoot?: string;
  runtimeDirectory?: string;
  instanceId?: string;
  connectTimeoutMs?: number;
  spawnDaemon?: boolean;
  daemonEntry?: string;
  clientId?: string;
};

export type OpenAgentEditorMainConnection = {
  client: HarnessClient;
  address: string;
  dataRoot: string;
  runtimeDirectory: string;
  workspaceHello: WorkspaceTransportHello;
  /** Processo main detém o HarnessClient; o renderer não. */
  processRole: "main";
  toolsAllowedInRenderer: false;
};

/**
 * Inicia (sob demanda) o harness-daemon e conecta o processo main do editor (LOC-01 / ADR-003).
 * Entrada inválida falha com INVALID_STATE sem efeito colateral no daemon.
 */
export async function connectOpenAgentEditorMain(
  input: OpenAgentEditorMainConnectInput,
): Promise<OpenAgentEditorMainConnection> {
  const validated = validateWorkspaceTransportHello(input.workspaceHello);
  if (!validated.valid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      EDITOR_MAIN_HELLO_INVALID_MESSAGE,
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
    clientId: input.clientId ?? OPENAGENT_EDITOR_MAIN_CLIENT_ID,
  });

  return {
    client,
    address: ready.address,
    dataRoot: ready.dataRoot,
    runtimeDirectory: ready.runtimeDirectory,
    workspaceHello: validated.value,
    processRole: "main",
    toolsAllowedInRenderer: false,
  };
}
