import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { assertValidWorkspaceId } from "../workspace-id.js";

export type StoredSession = {
  id: string;
  workspaceId: string;
  mode: string;
  branchId: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type StoredSessionWithResume = StoredSession & {
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

export type CreateStoredSessionInput = {
  sessionId: string;
  workspaceId: string;
  mode: string;
  branchId?: string | null;
  createdAt?: string;
};

const EMPTY_JSON_ARRAY = "[]";

function sessionInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    sessionInvalid(`${label} inválido.`);
  }
}

function workspaceExists(database: DatabaseSync, workspaceId: string): boolean {
  const row = database
    .prepare("SELECT id FROM workspace WHERE id = ?")
    .get(workspaceId) as { id?: string } | undefined;
  return row?.id === workspaceId;
}

type SessionRow = {
  id: string;
  workspaceId: string;
  mode: string;
  branchId: string | null;
  createdAt: string;
  deletedAt: string | null;
};

function sessionFromRow(row: SessionRow): StoredSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    mode: row.mode,
    branchId: row.branchId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

/** Cria uma sessão persistida e projeção vazia de retomada (SES-01). */
export function createStoredSession(
  database: DatabaseSync,
  input: CreateStoredSessionInput,
): StoredSession {
  requireNonEmptyString(input.sessionId, "sessionId");
  requireNonEmptyString(input.mode, "mode");
  assertValidWorkspaceId(input.workspaceId);

  if (!workspaceExists(database, input.workspaceId)) {
    sessionInvalid("workspaceId inexistente para criar sessão.", [input.workspaceId]);
  }

  const existing = database
    .prepare("SELECT id FROM session WHERE id = ?")
    .get(input.sessionId) as { id?: string } | undefined;
  if (existing?.id === input.sessionId) {
    sessionInvalid("sessionId já existe.", [input.sessionId]);
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const branchId = input.branchId ?? null;

  database
    .prepare(
      `INSERT INTO session(id, workspace_id, mode, branch_id, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(input.sessionId, input.workspaceId, input.mode, branchId, createdAt);

  database
    .prepare(
      `INSERT INTO session_resume(session_id, mode, messages_json, tools_json, attachments_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.sessionId, input.mode, EMPTY_JSON_ARRAY, EMPTY_JSON_ARRAY, EMPTY_JSON_ARRAY);

  return {
    id: input.sessionId,
    workspaceId: input.workspaceId,
    mode: input.mode,
    branchId,
    createdAt,
    deletedAt: null,
  };
}

/** Lista sessões ativas do workspace com dados de retomada (modo, mensagens, ferramentas, anexos). */
export function listStoredSessionsByWorkspace(
  database: DatabaseSync,
  workspaceId: string,
): StoredSessionWithResume[] {
  assertValidWorkspaceId(workspaceId);

  const rows = database
    .prepare(
      `SELECT
         s.id AS id,
         s.workspace_id AS workspaceId,
         s.mode AS mode,
         s.branch_id AS branchId,
         s.created_at AS createdAt,
         s.deleted_at AS deletedAt,
         COALESCE(r.messages_json, ?) AS messagesJson,
         COALESCE(r.tools_json, ?) AS toolsJson,
         COALESCE(r.attachments_json, ?) AS attachmentsJson
       FROM session s
       LEFT JOIN session_resume r ON r.session_id = s.id
       WHERE s.workspace_id = ? AND s.deleted_at IS NULL
       ORDER BY s.created_at, s.id`,
    )
    .all(
      EMPTY_JSON_ARRAY,
      EMPTY_JSON_ARRAY,
      EMPTY_JSON_ARRAY,
      workspaceId,
    ) as (SessionRow & {
      messagesJson: string;
      toolsJson: string;
      attachmentsJson: string;
    })[];

  return rows.map((row) => ({
    ...sessionFromRow(row),
    messagesJson: row.messagesJson,
    toolsJson: row.toolsJson,
    attachmentsJson: row.attachmentsJson,
  }));
}
