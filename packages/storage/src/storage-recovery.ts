import type { DatabaseSync } from "node:sqlite";
import { rebuildProjectionsFromEventLog } from "./event-log-projections.js";

export type RecoverWorkspaceStorageResult = {
  recoveredSessionIds: string[];
};

/**
 * Sessões com ao menos um evento commitado no log append-only.
 */
export function listSessionIdsWithCommittedEventLog(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      `SELECT DISTINCT r.session_id AS sessionId
       FROM harness_event he
       INNER JOIN run r ON r.id = he.run_id
       ORDER BY r.session_id`,
    )
    .all() as { sessionId: string }[];
  return rows.map((row) => row.sessionId);
}

/**
 * Recovery pós-crash: preserva o log commitado e reconstrói projeções (SES-01).
 */
export function recoverWorkspaceStorageAfterCrash(
  database: DatabaseSync,
  casRoot: string,
): RecoverWorkspaceStorageResult {
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  const sessionIds = listSessionIdsWithCommittedEventLog(database);
  const recoveredSessionIds: string[] = [];

  for (const sessionId of sessionIds) {
    rebuildProjectionsFromEventLog(database, casRoot, sessionId);
    recoveredSessionIds.push(sessionId);
  }

  return { recoveredSessionIds };
}
