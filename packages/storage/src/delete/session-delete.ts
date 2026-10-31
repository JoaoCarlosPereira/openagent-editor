import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { CAS_CONTENT_REF_PREFIX } from "../cas.js";
import { collectUnreferencedCasBlobs, releaseCasBlobRef } from "../cas-gc.js";
import {
  contentRefsFromJsonField,
  dedupeContentRefs,
} from "./cas-content-refs.js";

function deleteInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function listRunIdsForSession(database: DatabaseSync, sessionId: string): string[] {
  const rows = database
    .prepare("SELECT id FROM run WHERE session_id = ? ORDER BY id")
    .all(sessionId) as { id: string }[];
  return rows.map((row) => row.id);
}

function sessionDeleteTargetExists(database: DatabaseSync, sessionId: string): boolean {
  const resume = database
    .prepare("SELECT session_id AS sessionId FROM session_resume WHERE session_id = ?")
    .get(sessionId) as { sessionId?: string } | undefined;
  if (resume?.sessionId === sessionId) {
    return true;
  }
  const session = database
    .prepare("SELECT id FROM session WHERE id = ? AND deleted_at IS NULL")
    .get(sessionId) as { id?: string } | undefined;
  return session?.id === sessionId;
}

function collectSessionContentRefs(database: DatabaseSync, sessionId: string): string[] {
  const refs: string[] = [];

  const resume = database
    .prepare(
      `SELECT messages_json AS messagesJson, tools_json AS toolsJson, attachments_json AS attachmentsJson
       FROM session_resume WHERE session_id = ?`,
    )
    .get(sessionId) as
    | { messagesJson?: string; toolsJson?: string; attachmentsJson?: string }
    | undefined;

  if (resume?.messagesJson !== undefined) {
    refs.push(
      ...contentRefsFromJsonField(resume.messagesJson, "messages_json"),
      ...contentRefsFromJsonField(resume.toolsJson ?? "[]", "tools_json"),
      ...contentRefsFromJsonField(resume.attachmentsJson ?? "[]", "attachments_json"),
    );
  }

  const messageRows = database
    .prepare("SELECT content_ref AS contentRef FROM message WHERE session_id = ?")
    .all(sessionId) as { contentRef: string }[];
  for (const row of messageRows) {
    if (row.contentRef.startsWith(CAS_CONTENT_REF_PREFIX)) {
      refs.push(row.contentRef);
    }
  }

  const runIds = listRunIdsForSession(database, sessionId);
  for (const runId of runIds) {
    const toolRows = database
      .prepare("SELECT result_ref AS resultRef FROM tool_invocation WHERE run_id = ?")
      .all(runId) as { resultRef: string | null }[];
    for (const row of toolRows) {
      if (row.resultRef?.startsWith(CAS_CONTENT_REF_PREFIX)) {
        refs.push(row.resultRef);
      }
    }

    const queueRows = database
      .prepare("SELECT payload_ref AS payloadRef FROM queue_item WHERE run_id = ?")
      .all(runId) as { payloadRef: string }[];
    for (const row of queueRows) {
      if (row.payloadRef.startsWith(CAS_CONTENT_REF_PREFIX)) {
        refs.push(row.payloadRef);
      }
    }

    const agentRows = database
      .prepare("SELECT result_ref AS resultRef FROM agent_node WHERE run_id = ?")
      .all(runId) as { resultRef: string | null }[];
    for (const row of agentRows) {
      if (row.resultRef?.startsWith(CAS_CONTENT_REF_PREFIX)) {
        refs.push(row.resultRef);
      }
    }

    const eventRows = database
      .prepare("SELECT payload_ref AS payloadRef FROM harness_event WHERE run_id = ?")
      .all(runId) as { payloadRef: string }[];
    for (const row of eventRows) {
      if (row.payloadRef.startsWith(CAS_CONTENT_REF_PREFIX)) {
        refs.push(row.payloadRef);
      }
    }
  }

  return dedupeContentRefs(refs);
}

function removeSessionProjections(database: DatabaseSync, sessionId: string): void {
  const runIds = listRunIdsForSession(database, sessionId);
  for (const runId of runIds) {
    database.prepare("DELETE FROM harness_event WHERE run_id = ?").run(runId);
    database.prepare("DELETE FROM tool_invocation WHERE run_id = ?").run(runId);
    database.prepare("DELETE FROM queue_item WHERE run_id = ?").run(runId);
    database.prepare("DELETE FROM agent_node WHERE run_id = ?").run(runId);
    database.prepare("DELETE FROM run WHERE id = ?").run(runId);
  }
  database.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
  database.prepare("DELETE FROM session_resume WHERE session_id = ?").run(sessionId);
  database.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
}

export type DeleteSessionStorageResult = {
  sessionId: string;
  releasedRefCount: number;
  removedBlobCount: number;
};

/**
 * Apaga a sessão local: projeções normalizadas, retomada JSON, refs CAS e blobs órfãos (SES-07).
 */
export function deleteSessionStorage(
  database: DatabaseSync,
  casRoot: string,
  sessionId: string,
): DeleteSessionStorageResult {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    deleteInvalid("sessionId inválido para exclusão.");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    if (!sessionDeleteTargetExists(database, sessionId)) {
      deleteInvalid("sessão inexistente para exclusão.", [sessionId]);
    }

    const refs = collectSessionContentRefs(database, sessionId);

    for (const contentRef of refs) {
      releaseCasBlobRef(database, contentRef);
    }

    removeSessionProjections(database, sessionId);

    const gc = collectUnreferencedCasBlobs(database, casRoot);
    database.exec("COMMIT");

    return {
      sessionId,
      releasedRefCount: refs.length,
      removedBlobCount: gc.removedBlobCount,
    };
  } catch (cause) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Transação já encerrada.
    }
    if (cause instanceof ProtocolError) {
      throw cause;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    deleteInvalid("falha ao apagar sessão.", [detail]);
  }
}
