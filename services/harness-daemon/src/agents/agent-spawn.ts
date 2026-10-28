import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type RpcParamsMap,
  type RpcResultMap,
  RPC_METHOD,
} from "@openagent/protocol";
import { persistHarnessEventWithPayload } from "@openagent/policy";
import { openWorkspaceDatabase, type WorkspaceDatabase } from "@openagent/storage";
import type { RunLifecycleState } from "../state/run-state.js";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export const AGENT_SPAWNED_EVENT = "agent.spawned";
export const AGENT_COMPLETED_EVENT = "agent.completed";

const AGENT_NAME_MAX = 200;

function withSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

function loadRunLifecycleState(db: WorkspaceDatabase, runId: string): RunLifecycleState | null {
  return withSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare("SELECT state FROM run WHERE id = ?")
      .get(runId) as { state?: string } | undefined;
    if (!row?.state) {
      return null;
    }
    if (
      row.state === "idle" ||
      row.state === "running" ||
      row.state === "completed" ||
      row.state === "cancelled"
    ) {
      return row.state;
    }
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Estado de run persistido inválido: ${row.state}`,
    );
  });
}

function agentDisplayName(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= AGENT_NAME_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, AGENT_NAME_MAX - 1)}…`;
}

function updateAgentNodeState(
  db: WorkspaceDatabase,
  agentId: string,
  state: string,
  resultRef: string | null,
): void {
  withSqlite(db, (sqlite) => {
    const updated = sqlite
      .prepare("UPDATE agent_node SET state = ?, result_ref = ? WHERE id = ?")
      .run(state, resultRef, agentId);
    if (updated.changes !== 1) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "agent_node inexistente para atualização.",
        [agentId],
      );
    }
  });
}

function assertSpawnPreconditions(
  context: DaemonRpcContext,
  runId: string,
  db: WorkspaceDatabase,
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
    const name = agentDisplayName(objective);

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
      objective: objective.trim(),
    });

    const resultBody = JSON.stringify({
      agentId,
      objective: objective.trim(),
      summary: `Subagente "${name}" concluiu o objetivo local.`,
    });
    const resultCas = db.putCasBlob(Buffer.from(resultBody, "utf8"));

    updateAgentNodeState(db, agentId, "complete", resultCas.contentRef);

    persistHarnessEventWithPayload(db, runId, AGENT_COMPLETED_EVENT, {
      agentId,
      name,
      resultRef: resultCas.contentRef,
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
