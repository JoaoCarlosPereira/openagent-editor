import type { AgentMode } from "@openagent/protocol";
import type { StoredSessionWithResume, WorkspaceDatabase } from "@openagent/storage";

export type SessionListResumeEntry = {
  sessionId: string;
  mode: AgentMode;
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

function casBlobExists(database: WorkspaceDatabase, contentRef: string): boolean {
  try {
    database.readCasBlob(contentRef);
    return true;
  } catch {
    return false;
  }
}

/** Mantém anexos sem contentRef ou cujo blob CAS ainda existe (SES-01). */
export function filterExistingAttachmentsJson(
  database: WorkspaceDatabase,
  attachmentsJson: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(attachmentsJson) as unknown;
  } catch {
    return "[]";
  }
  if (!Array.isArray(parsed)) {
    return "[]";
  }

  const kept: unknown[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const contentRef = (item as { contentRef?: unknown }).contentRef;
    if (typeof contentRef !== "string" || contentRef.trim().length === 0) {
      kept.push(item);
      continue;
    }
    if (casBlobExists(database, contentRef)) {
      kept.push(item);
    }
  }
  return JSON.stringify(kept);
}

export function mapStoredSessionToListEntry(
  database: WorkspaceDatabase,
  row: StoredSessionWithResume,
  mode: AgentMode,
): SessionListResumeEntry {
  return {
    sessionId: row.id,
    mode,
    messagesJson: row.messagesJson,
    toolsJson: row.toolsJson,
    attachmentsJson: filterExistingAttachmentsJson(database, row.attachmentsJson),
  };
}
