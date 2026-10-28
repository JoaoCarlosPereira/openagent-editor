import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HarnessEvent } from "@openagent/protocol";
import {
  appendHarnessEvent,
  listHarnessEvents,
  type AppendHarnessEventInput,
} from "./event-log.js";
import { putCasBlob, readCasBlob, type PutCasBlobResult } from "./cas.js";
import { deleteSessionStorage, type DeleteSessionStorageResult } from "./delete.js";
import { runStorageMigrations } from "./migration-runner.js";
import { STORAGE_MIGRATIONS } from "./migrations/index.js";
import { STORAGE_SCHEMA_VERSION } from "./schema-version.js";
import {
  insertStoredAgentNode,
  insertStoredMessage,
  insertStoredQueueItem,
  insertStoredToolInvocation,
  listStoredAgentNodes,
  listStoredMessages,
  listStoredQueueItems,
  listStoredToolInvocations,
  removePendingQueueItem,
  type RemovePendingQueueItemResult,
  type StoredAgentNode,
  type StoredMessage,
  type StoredQueueItem,
  type StoredToolInvocation,
} from "./session-projections.js";
import {
  applyHarnessEventToProjections,
  rebuildProjectionsFromEventLog,
  syncSessionResumeProjection,
  type ApplyContext,
  type RebuildProjectionsFromEventLogResult,
} from "./event-log-projections.js";
import {
  indexMessageFts,
  lexicalTextFromContentRef,
  searchSessionMessages,
  type SearchSessionMessagesInput,
  type SearchSessionMessagesResult,
} from "./search/index.js";
import {
  recoverWorkspaceStorageAfterCrash,
  type RecoverWorkspaceStorageResult,
} from "./storage-recovery.js";
import { assertValidWorkspaceId } from "./workspace-id.js";

export { STORAGE_SCHEMA_VERSION };

export type SessionResumeRecord = {
  sessionId: string;
  mode: string;
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

export type OpenWorkspaceDatabaseOptions = {
  /** Raiz de dados do produto (ex.: ~/.openagent). */
  dataRoot: string;
  workspaceId: string;
};

export type WorkspaceDatabase = {
  readonly workspaceId: string;
  readonly databasePath: string;
  readonly journalMode: "wal";
  putSessionResume(record: SessionResumeRecord): void;
  listSessionResumes(): SessionResumeRecord[];
  appendHarnessEvent(input: AppendHarnessEventInput): HarnessEvent;
  listHarnessEvents(runId?: string): HarnessEvent[];
  putCasBlob(content: Uint8Array): PutCasBlobResult;
  readCasBlob(contentRef: string): Uint8Array;
  insertMessage(message: StoredMessage): StoredMessage;
  listMessages(sessionId: string): StoredMessage[];
  insertToolInvocation(invocation: StoredToolInvocation): StoredToolInvocation;
  listToolInvocations(runId: string): StoredToolInvocation[];
  insertAgentNode(node: StoredAgentNode): StoredAgentNode;
  listAgentNodes(runId: string): StoredAgentNode[];
  insertQueueItem(item: StoredQueueItem): StoredQueueItem;
  listQueueItems(runId: string): StoredQueueItem[];
  removePendingQueueItem(
    runId: string,
    queueItemId: string,
  ): RemovePendingQueueItemResult;
  searchSessionMessages(input: SearchSessionMessagesInput): SearchSessionMessagesResult;
  deleteSession(sessionId: string): DeleteSessionStorageResult;
  applyHarnessEventToProjections(event: HarnessEvent): void;
  rebuildProjectionsFromEventLog(sessionId: string): RebuildProjectionsFromEventLogResult;
  recoverFromCommittedEventLog(): RecoverWorkspaceStorageResult;
  close(): void;
};

function readJournalMode(database: DatabaseSync): "wal" {
  const row = database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
  const mode = row.journal_mode?.toLowerCase();
  if (mode !== "wal") {
    throw new Error(`journal_mode esperado WAL, recebido: ${mode ?? "desconhecido"}`);
  }
  return "wal";
}

type SessionResumeRow = {
  sessionId: string;
  mode: string;
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

function sessionResumeFromRow(row: SessionResumeRow): SessionResumeRecord {
  return {
    sessionId: row.sessionId,
    mode: row.mode,
    messagesJson: row.messagesJson,
    toolsJson: row.toolsJson,
    attachmentsJson: row.attachmentsJson,
  };
}

export function resolveWorkspaceDatabasePath(
  dataRoot: string,
  workspaceId: string,
): string {
  assertValidWorkspaceId(workspaceId);
  return join(dataRoot, "workspaces", workspaceId, "state.sqlite3");
}

export function openWorkspaceDatabase(
  options: OpenWorkspaceDatabaseOptions,
): WorkspaceDatabase {
  assertValidWorkspaceId(options.workspaceId);

  const workspaceDirectory = join(options.dataRoot, "workspaces", options.workspaceId);
  mkdirSync(workspaceDirectory, { recursive: true });
  const casRoot = join(workspaceDirectory, "cas");
  mkdirSync(casRoot, { recursive: true });
  const databasePath = join(workspaceDirectory, "state.sqlite3");

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  const journalMode = readJournalMode(database);
  runStorageMigrations(database, STORAGE_MIGRATIONS);
  const recoveryResult = recoverWorkspaceStorageAfterCrash(database, casRoot);

  const upsert = database.prepare(`
    INSERT INTO session_resume(
      session_id, mode, messages_json, tools_json, attachments_json
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      mode = excluded.mode,
      messages_json = excluded.messages_json,
      tools_json = excluded.tools_json,
      attachments_json = excluded.attachments_json
  `);

  let projectionContext: ApplyContext = {
    mode: "ask",
    attachments: [],
  };

  if (recoveryResult.recoveredSessionIds.length > 0) {
    const primarySessionId = recoveryResult.recoveredSessionIds[0];
    if (primarySessionId) {
      const modeRow = database
        .prepare("SELECT mode FROM session WHERE id = ?")
        .get(primarySessionId) as { mode?: string } | undefined;
      if (modeRow?.mode) {
        projectionContext = { mode: modeRow.mode, attachments: [] };
      }
    }
  }

  const selectAll = database.prepare(`
    SELECT
      session_id AS sessionId,
      mode,
      messages_json AS messagesJson,
      tools_json AS toolsJson,
      attachments_json AS attachmentsJson
    FROM session_resume
    ORDER BY session_id
  `);

  return {
    workspaceId: options.workspaceId,
    databasePath,
    journalMode,
    putSessionResume(record: SessionResumeRecord) {
      upsert.run(
        record.sessionId,
        record.mode,
        record.messagesJson,
        record.toolsJson,
        record.attachmentsJson,
      );
    },
    listSessionResumes(): SessionResumeRecord[] {
      const rows = selectAll.all() as SessionResumeRow[];
      return rows.map(sessionResumeFromRow);
    },
    appendHarnessEvent(input: AppendHarnessEventInput) {
      return appendHarnessEvent(database, input);
    },
    listHarnessEvents(runId?: string) {
      return listHarnessEvents(database, runId);
    },
    putCasBlob(content: Uint8Array) {
      return putCasBlob(database, casRoot, content);
    },
    readCasBlob(contentRef: string) {
      return readCasBlob(database, casRoot, contentRef);
    },
    insertMessage(message: StoredMessage) {
      const stored = insertStoredMessage(database, message);
      const lexicalText = lexicalTextFromContentRef(database, casRoot, stored.contentRef);
      indexMessageFts(database, {
        messageId: stored.id,
        sessionId: stored.sessionId,
        lexicalText,
      });
      return stored;
    },
    searchSessionMessages(input: SearchSessionMessagesInput) {
      return searchSessionMessages(database, input);
    },
    listMessages(sessionId: string) {
      return listStoredMessages(database, sessionId);
    },
    insertToolInvocation(invocation: StoredToolInvocation) {
      return insertStoredToolInvocation(database, invocation);
    },
    listToolInvocations(runId: string) {
      return listStoredToolInvocations(database, runId);
    },
    insertAgentNode(node: StoredAgentNode) {
      return insertStoredAgentNode(database, node);
    },
    listAgentNodes(runId: string) {
      return listStoredAgentNodes(database, runId);
    },
    insertQueueItem(item: StoredQueueItem) {
      return insertStoredQueueItem(database, item);
    },
    listQueueItems(runId: string) {
      return listStoredQueueItems(database, runId);
    },
    removePendingQueueItem(runId: string, queueItemId: string) {
      return removePendingQueueItem(database, runId, queueItemId);
    },
    deleteSession(sessionId: string) {
      return deleteSessionStorage(database, casRoot, sessionId);
    },
    applyHarnessEventToProjections(event: HarnessEvent) {
      applyHarnessEventToProjections(database, casRoot, event, projectionContext);
      const sessionRow = database
        .prepare("SELECT session_id AS sessionId FROM run WHERE id = ?")
        .get(event.runId) as { sessionId?: string } | undefined;
      if (sessionRow?.sessionId) {
        syncSessionResumeProjection(database, sessionRow.sessionId, projectionContext);
      }
    },
    rebuildProjectionsFromEventLog(sessionId: string) {
      const result = rebuildProjectionsFromEventLog(database, casRoot, sessionId);
      projectionContext = {
        mode: result.mode,
        attachments: [],
      };
      return result;
    },
    recoverFromCommittedEventLog() {
      const result = recoverWorkspaceStorageAfterCrash(database, casRoot);
      const primarySessionId = result.recoveredSessionIds[0];
      if (primarySessionId) {
        const modeRow = database
          .prepare("SELECT mode FROM session WHERE id = ?")
          .get(primarySessionId) as { mode?: string } | undefined;
        if (modeRow?.mode) {
          projectionContext = { mode: modeRow.mode, attachments: [] };
        }
      }
      return result;
    },
    close() {
      database.close();
    },
  };
}
