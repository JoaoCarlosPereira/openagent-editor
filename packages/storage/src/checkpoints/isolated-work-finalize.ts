import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type { IsolatedWorkState, StoredIsolatedWorkRecord } from "./isolated-work-types.js";

function isolatedWorkInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStoredRow(row: {
  id: string;
  run_id: string;
  canonical_root: string;
  isolated_root: string;
  git_branch: string;
  state: string;
  created_at: string;
}): StoredIsolatedWorkRecord {
  const state = row.state as IsolatedWorkState;
  if (state !== "active" && state !== "applied" && state !== "discarded") {
    isolatedWorkInvalid("Estado de trabalho isolado inválido.", [row.state]);
  }
  return {
    id: row.id,
    runId: row.run_id,
    canonicalRoot: row.canonical_root,
    isolatedRoot: row.isolated_root,
    gitBranch: row.git_branch,
    state,
    createdAt: row.created_at,
  };
}

function loadRow(database: DatabaseSync, isolatedWorkId: string) {
  return database
    .prepare(
      `SELECT id, run_id, canonical_root, isolated_root, git_branch, state, created_at
       FROM isolated_work WHERE id = ?`,
    )
    .get(isolatedWorkId) as
    | {
        id: string;
        run_id: string;
        canonical_root: string;
        isolated_root: string;
        git_branch: string;
        state: string;
        created_at: string;
      }
    | undefined;
}

export function getStoredIsolatedWorkRecordById(
  database: DatabaseSync,
  isolatedWorkId: unknown,
): StoredIsolatedWorkRecord | null {
  if (!isNonEmptyString(isolatedWorkId)) {
    isolatedWorkInvalid("Identificador de trabalho isolado inválido.");
  }
  const row = loadRow(database, isolatedWorkId.trim());
  if (!row) {
    return null;
  }
  return parseStoredRow(row);
}

export type FinalizeStoredIsolatedWorkDecision = "apply" | "discard";

/**
 * SES-04: transiciona trabalho isolado de active para applied ou discarded.
 */
export function finalizeStoredIsolatedWork(
  database: DatabaseSync,
  isolatedWorkId: unknown,
  decision: FinalizeStoredIsolatedWorkDecision,
): StoredIsolatedWorkRecord {
  if (decision !== "apply" && decision !== "discard") {
    isolatedWorkInvalid("Decisão de trabalho isolado inválida.");
  }
  if (!isNonEmptyString(isolatedWorkId)) {
    isolatedWorkInvalid("Identificador de trabalho isolado inválido.");
  }

  const id = isolatedWorkId.trim();
  const row = loadRow(database, id);
  if (!row) {
    isolatedWorkInvalid("Trabalho isolado inexistente.", [id]);
  }
  if (row.state !== "active") {
    isolatedWorkInvalid("Trabalho isolado não está ativo para finalização.", [row.state]);
  }

  const nextState: IsolatedWorkState = decision === "apply" ? "applied" : "discarded";
  database.prepare("UPDATE isolated_work SET state = ? WHERE id = ? AND state = 'active'").run(
    nextState,
    id,
  );

  const updated = loadRow(database, id);
  if (!updated || updated.state !== nextState) {
    isolatedWorkInvalid("Falha ao finalizar trabalho isolado.", [id]);
  }

  return parseStoredRow(updated);
}
