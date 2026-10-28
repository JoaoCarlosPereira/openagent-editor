import { randomUUID } from "node:crypto";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type RpcParamsMap,
  type RpcResultMap,
  RPC_METHOD,
} from "@openagent/protocol";
import { persistHarnessEventWithPayload } from "@openagent/policy";
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  loadAgentNodeRow,
  loadRunLifecycleState,
  updateAgentNodeState,
} from "./agent-node-db.js";
import {
  parseSubagentObjectiveDelay,
  registerSubagentRun,
  unregisterSubagentRun,
  waitAbortableMs,
} from "./agent-subagent-runtime.js";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export const AGENT_SPAWNED_EVENT = "agent.spawned";
export const AGENT_COMPLETED_EVENT = "agent.completed";

const AGENT_NAME_MAX = 200;

function agentDisplayName(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= AGENT_NAME_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, AGENT_NAME_MAX - 1)}…`;
}

function assertSpawnPreconditions(
  context: DaemonRpcContext,
  runId: string,
  db: ReturnType<typeof openWorkspaceDatabase>,
): void {
  const lifecycle = loadRunLifecycleState(db, runId);
  if (lifecycle === null) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "runId inexistente para agent.spawn.",
      [runId],
    );
  }
  if (lifecycle !== "running") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Subagente só pode ser criado com execução em andamento.",
      [runId, lifecycle],
    );
  }
  if (context.binding.workspaceId.trim().length === 0) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "workspaceId inválido.");
  }
}

async function runSubagentToCompletion(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
  objective: string,
  signal: AbortSignal,
): Promise<void> {
  const { delayMs, objectiveText } = parseSubagentObjectiveDelay(objective);
  try {
    await waitAbortableMs(delayMs, signal);
  } catch (error) {
    if (error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.CANCELLED) {
      return;
    }
    throw error;
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const node = loadAgentNodeRow(db, agentId);
    if (!node || node.state !== "running") {
      return;
    }

    const name = node.name;
    const resultBody = JSON.stringify({
      agentId,
      objective: objectiveText,
      summary: `Subagente "${name}" concluiu o objetivo local.`,
    });
    const resultCas = db.putCasBlob(Buffer.from(resultBody, "utf8"));
    updateAgentNodeState(db, agentId, "complete", resultCas.contentRef);
    persistHarnessEventWithPayload(db, runId, AGENT_COMPLETED_EVENT, {
      agentId,
      name,
      resultRef: resultCas.contentRef,
    });
  } finally {
    db.close();
    unregisterSubagentRun(context, runId, agentId);
  }
}

/**
 * AGT-05: cria subagente local com AgentNode próprio (nome, estado, resultado) no run pai.
 */
export function spawnSubagentFromObjective(
  context: DaemonRpcContext,
  runId: string,
  objective: string,
): RpcResultMap[typeof RPC_METHOD.AGENT_SPAWN] {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertSpawnPreconditions(context, runId, db);

    const agentId = randomUUID();
    const { objectiveText } = parseSubagentObjectiveDelay(objective);
    const name = agentDisplayName(objectiveText.length > 0 ? objectiveText : objective);

    db.insertAgentNode({
      id: agentId,
      runId,
      parentId: null,
      name,
      state: "running",
      resultRef: null,
    });

    persistHarnessEventWithPayload(db, runId, AGENT_SPAWNED_EVENT, {
      agentId,
      name,
      objective: objectiveText.length > 0 ? objectiveText : objective.trim(),
    });

    const abortController = registerSubagentRun(context, runId, agentId);
    void runSubagentToCompletion(
      context,
      runId,
      agentId,
      objective,
      abortController.signal,
    ).catch(() => {
      unregisterSubagentRun(context, runId, agentId);
    });

    return { agentId };
  } finally {
    db.close();
  }
}

export function handleAgentSpawn(
  context: DaemonRpcContext,
  runId: string,
  params: RpcParamsMap[typeof RPC_METHOD.AGENT_SPAWN],
): RpcResultMap[typeof RPC_METHOD.AGENT_SPAWN] {
  return spawnSubagentFromObjective(context, runId, params.objective);
}
