import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type { StoredIsolatedWorkRecord } from "./isolated-work-types.js";

function isolatedWorkInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertRunExists(database: DatabaseSync, runId: string): void {
  const row = database
    .prepare("SELECT id FROM run WHERE id = ?")
    .get(runId) as { id?: string } | undefined;
  if (!row?.id) {
    isolatedWorkInvalid("Run inexistente para trabalho isolado.", [runId]);
  }
}

export type CreateStoredIsolatedWorkInput = {
  runId: unknown;
  isolatedWorkId: unknown;
  canonicalRoot: unknown;
  isolatedRoot: unknown;
  gitBranch: unknown;
};

/**
 * SES-04: persiste metadados do worktree isolado vinculado ao run (estado active até task_73).
 */
export function createStoredIsolatedWork(
  database: DatabaseSync,
  input: CreateStoredIsolatedWorkInput,
): StoredIsolatedWorkRecord {
  if (!isNonEmptyString(input.runId)) {
    isolatedWorkInvalid("Campo 'runId' ausente ou inválido.");
  }
  if (!isNonEmptyString(input.isolatedWorkId)) {
    isolatedWorkInvalid("Campo 'isolatedWorkId' ausente ou inválido.");
  }
  if (!isNonEmptyString(input.canonicalRoot)) {
    isolatedWorkInvalid("Campo 'canonicalRoot' ausente ou inválido.");
  }
  if (!isNonEmptyString(input.isolatedRoot)) {
    isolatedWorkInvalid("Campo 'isolatedRoot' ausente ou inválido.");
  }
  if (!isNonEmptyString(input.gitBranch)) {
    isolatedWorkInvalid("Campo 'gitBranch' ausente ou inválido.");
  }

  const runId = input.runId.trim();
  const isolatedWorkId = input.isolatedWorkId.trim();
  assertRunExists(database, runId);

  const existing = database
    .prepare("SELECT id FROM isolated_work WHERE id = ?")
    .get(isolatedWorkId) as { id?: string } | undefined;
  if (existing?.id) {
    isolatedWorkInvalid("Trabalho isolado já registrado.", [isolatedWorkId]);
  }

  const id = isolatedWorkId;
  const createdAt = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO isolated_work(
         id, run_id, canonical_root, isolated_root, git_branch, state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      runId,
      input.canonicalRoot.trim(),
      input.isolatedRoot.trim(),
      input.gitBranch.trim(),
      "active",
      createdAt,
    );

  return {
    id,
    runId,
    canonicalRoot: input.canonicalRoot.trim(),
    isolatedRoot: input.isolatedRoot.trim(),
    gitBranch: input.gitBranch.trim(),
    state: "active",
    createdAt,
  };
}

export function getStoredIsolatedWorkById(
  database: DatabaseSync,
  isolatedWorkId: unknown,
): StoredIsolatedWorkRecord | null {
  if (!isNonEmptyString(isolatedWorkId)) {
    isolatedWorkInvalid("Identificador de trabalho isolado inválido.");
  }
  const row = database
    .prepare(
      `SELECT id, run_id, canonical_root, isolated_root, git_branch, state, created_at
       FROM isolated_work WHERE id = ?`,
    )
    .get(isolatedWorkId.trim()) as
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

  if (!row) {
    return null;
  }
  if (row.state !== "active") {
    isolatedWorkInvalid("Estado de trabalho isolado inválido para leitura.", [row.state]);
  }

  return {
    id: row.id,
    runId: row.run_id,
    canonicalRoot: row.canonical_root,
    isolatedRoot: row.isolated_root,
    gitBranch: row.git_branch,
    state: "active",
    createdAt: row.created_at,
  };
}
