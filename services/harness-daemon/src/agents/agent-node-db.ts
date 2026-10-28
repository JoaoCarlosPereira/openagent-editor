import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import type { WorkspaceDatabase } from "@openagent/storage";
import type { RunLifecycleState } from "../state/run-state.js";

export function withAgentSqlite<T>(db: WorkspaceDatabase, run: (sqlite: DatabaseSync) => T): T {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

export function loadRunSessionId(db: WorkspaceDatabase, runId: string): string {
  return withAgentSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare("SELECT session_id FROM run WHERE id = ?")
      .get(runId) as { session_id?: string } | undefined;
    if (!row?.session_id) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "sessionId ausente para run do subagente.",
        [runId],
      );
    }
    return row.session_id;
  });
}

export function loadRunLifecycleState(db: WorkspaceDatabase, runId: string): RunLifecycleState | null {
  return withAgentSqlite(db, (sqlite) => {
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

export type StoredAgentNodeRow = {
  id: string;
  run_id: string;
  parent_id: string | null;
  name: string;
  state: string;
  result_ref: string | null;
};

export function loadAgentNodeRow(
  db: WorkspaceDatabase,
  agentId: string,
): StoredAgentNodeRow | null {
  return withAgentSqlite(db, (sqlite) => {
    const row = sqlite
      .prepare(
        "SELECT id, run_id, parent_id, name, state, result_ref FROM agent_node WHERE id = ?",
      )
      .get(agentId) as StoredAgentNodeRow | undefined;
    return row ?? null;
  });
}

export function updateAgentNodeState(
  db: WorkspaceDatabase,
  agentId: string,
  state: string,
  resultRef: string | null,
): void {
  withAgentSqlite(db, (sqlite) => {
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
