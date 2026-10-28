import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { CAS_CONTENT_REF_PREFIX } from "./cas.js";
import { collectUnreferencedCasBlobs, releaseCasBlobRef } from "./cas-gc.js";

function deleteInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function collectContentRefs(value: unknown, refs: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    if (value.startsWith(CAS_CONTENT_REF_PREFIX)) {
      refs.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectContentRefs(item, refs);
    }
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectContentRefs(entry, refs);
    }
  }
}

function contentRefsFromJsonField(jsonText: string, fieldLabel: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    deleteInvalid(`JSON inválido em ${fieldLabel}.`);
  }
  const refs: string[] = [];
  collectContentRefs(parsed, refs);
  return refs;
}

export type DeleteSessionStorageResult = {
  sessionId: string;
  releasedRefCount: number;
  removedBlobCount: number;
};

/**
 * Apaga a projeção local da sessão, libera refs CAS das mensagens/anexos e coleta blobs órfãos.
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
    const row = database
      .prepare(
        `SELECT messages_json AS messagesJson, attachments_json AS attachmentsJson
         FROM session_resume WHERE session_id = ?`,
      )
      .get(sessionId) as
      | { messagesJson?: string; attachmentsJson?: string }
      | undefined;

    if (row?.messagesJson === undefined) {
      deleteInvalid("sessão inexistente para exclusão.", [sessionId]);
    }

    const refs = [
      ...contentRefsFromJsonField(row.messagesJson, "messages_json"),
      ...contentRefsFromJsonField(row.attachmentsJson ?? "[]", "attachments_json"),
    ];

    for (const contentRef of refs) {
      releaseCasBlobRef(database, contentRef);
    }

    database.prepare("DELETE FROM session_resume WHERE session_id = ?").run(sessionId);

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
