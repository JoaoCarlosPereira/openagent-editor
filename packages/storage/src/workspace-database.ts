import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HarnessEvent } from "@openagent/protocol";
import {
  appendHarnessEvent,
  listHarnessEvents,
  type AppendHarnessEventInput,
} from "./event-log.js";
import { runStorageMigrations } from "./migration-runner.js";
import { STORAGE_MIGRATIONS } from "./migrations/index.js";
import { STORAGE_SCHEMA_VERSION } from "./schema-version.js";
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
  const databasePath = join(workspaceDirectory, "state.sqlite3");

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  const journalMode = readJournalMode(database);
  runStorageMigrations(database, STORAGE_MIGRATIONS);

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
    close() {
      database.close();
    },
  };
}
