import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import type { StoredSession } from "./session-repository.js";

export type ForkStoredSessionInput = {
  parentSessionId: string;
  forkSessionId: string;
  createdAt?: string;
};

export type ForkStoredSessionResult = {
  parentSessionId: string;
  fork: StoredSession;
};

const EMPTY_JSON_ARRAY = "[]";

function forkInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    forkInvalid(`${label} inválido.`);
  }
}

type ParentSessionRow = {
  id: string;
  workspaceId: string;
  mode: string;
  branchId: string | null;
  createdAt: string;
};

type ParentResumeRow = {
  mode: string;
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

/** Cria conversa lateral copiando retomada da sessão principal (SES-06). */
export function forkStoredSession(
  database: DatabaseSync,
  input: ForkStoredSessionInput,
): ForkStoredSessionResult {
  requireNonEmptyString(input.parentSessionId, "parentSessionId");
  requireNonEmptyString(input.forkSessionId, "forkSessionId");

  if (input.parentSessionId === input.forkSessionId) {
    forkInvalid("forkSessionId deve ser distinto de parentSessionId.");
  }

  const parent = database
    .prepare(
      `SELECT id, workspace_id AS workspaceId, mode, branch_id AS branchId, created_at AS createdAt
       FROM session
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(input.parentSessionId) as ParentSessionRow | undefined;

  if (parent?.id !== input.parentSessionId) {
    forkInvalid("parentSessionId inexistente ou apagado.", [input.parentSessionId]);
  }

  const existingFork = database
    .prepare("SELECT id FROM session WHERE id = ?")
    .get(input.forkSessionId) as { id?: string } | undefined;
  if (existingFork?.id === input.forkSessionId) {
    forkInvalid("forkSessionId já existe.", [input.forkSessionId]);
  }

  const resume = database
    .prepare(
      `SELECT mode, messages_json AS messagesJson, tools_json AS toolsJson,
              attachments_json AS attachmentsJson
       FROM session_resume WHERE session_id = ?`,
    )
    .get(input.parentSessionId) as ParentResumeRow | undefined;

  const messagesJson = resume?.messagesJson ?? EMPTY_JSON_ARRAY;
  const toolsJson = resume?.toolsJson ?? EMPTY_JSON_ARRAY;
  const attachmentsJson = resume?.attachmentsJson ?? EMPTY_JSON_ARRAY;
  const mode = resume?.mode ?? parent.mode;
  const createdAt = input.createdAt ?? new Date().toISOString();

  database
    .prepare(
      `INSERT INTO session(id, workspace_id, mode, branch_id, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      input.forkSessionId,
      parent.workspaceId,
      mode,
      input.parentSessionId,
      createdAt,
    );

  database
    .prepare(
      `INSERT INTO session_resume(session_id, mode, messages_json, tools_json, attachments_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.forkSessionId, mode, messagesJson, toolsJson, attachmentsJson);

  return {
    parentSessionId: input.parentSessionId,
    fork: {
      id: input.forkSessionId,
      workspaceId: parent.workspaceId,
      mode,
      branchId: input.parentSessionId,
      createdAt,
      deletedAt: null,
    },
  };
}
