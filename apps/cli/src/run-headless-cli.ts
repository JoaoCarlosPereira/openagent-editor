import { randomUUID } from "node:crypto";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateUserInput,
  type AgentMode,
  type HarnessEvent,
  type Session,
  type UserInput,
} from "@openagent/protocol";
import {
  startOpenAgentCliInWorkspace,
  type OpenAgentCliWorkspaceReuseSnapshot,
  type StartOpenAgentCliInWorkspaceInput,
} from "./start-workspace-cli.js";

export type RunOpenAgentCliHeadlessInput = StartOpenAgentCliInWorkspaceInput & {
  /** Mensagem/anexo da execução headless (VAL-01). */
  input: unknown;
  /** Identificador estável do run; gerado se omitido. */
  runId?: string;
  /** Override de modo da execução (default: mode da sessão). */
  runMode?: AgentMode;
};

export type OpenAgentCliHeadlessResult = {
  session: Session;
  runId: string;
  workspaceId: string;
  events: readonly HarnessEvent[];
  reused: OpenAgentCliWorkspaceReuseSnapshot;
};

function resolveHeadlessUserInput(raw: unknown): UserInput {
  const validated = validateUserInput(raw);
  if (!validated.valid) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      validated.userMessage ??
        "Entrada inválida para execução headless da CLI.",
      validated.errors,
    );
  }
  return validated.value;
}

/**
 * Executa um run headless da CLI e encerra a conexão, persistindo a sessão no daemon (CLI-02).
 * Ao reabrir o mesmo workspace (ex.: editor), a sessão aparece em workspace.ack.sessionIds.
 */
export async function runOpenAgentCliHeadless(
  input: RunOpenAgentCliHeadlessInput,
): Promise<OpenAgentCliHeadlessResult> {
  const userInput = resolveHeadlessUserInput(input.input);
  const runId =
    typeof input.runId === "string" && input.runId.trim().length > 0
      ? input.runId.trim()
      : `run-${randomUUID()}`;

  const started = await startOpenAgentCliInWorkspace(input);
  const { connection, session, reused } = started;

  try {
    const events: HarnessEvent[] = [];
    for await (const event of connection.client.startRun({
      sessionId: session.sessionId,
      runId,
      mode: input.runMode ?? session.mode,
      input: userInput,
    })) {
      events.push(event);
    }

    if (events.length === 0) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "run.start headless não emitiu HarnessEvent.",
        [runId],
      );
    }

    return {
      session,
      runId,
      workspaceId: session.workspaceId,
      events,
      reused,
    };
  } finally {
    connection.client.close();
  }
}
