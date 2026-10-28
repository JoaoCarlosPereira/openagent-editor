import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertValidWorkspaceId } from "./workspace-id.js";

export const STORAGE_SCHEMA_VERSION = 1;

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
  close(): void;
};

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS storage_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_resume (
  session_id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL
);
`;

function readJournalMode(database: DatabaseSync): "wal" {
  const row = database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
  const mode = row.journal_mode?.toLowerCase();
  if (mode !== "wal") {
    throw new Error(`journal_mode esperado WAL, recebido: ${mode ?? "desconhecido"}`);
  }
  return "wal";
}

function bootstrapSchema(database: DatabaseSync): void {
  database.exec(INITIAL_SCHEMA_SQL);
  database
    .prepare(
      `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(STORAGE_SCHEMA_VERSION));
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
  bootstrapSchema(database);

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
      const rows = selectAll.all() as Array<Record<string, string>>;
      return rows.map((row) => ({
        sessionId: row.sessionId,
        mode: row.mode,
        messagesJson: row.messagesJson,
        toolsJson: row.toolsJson,
        attachmentsJson: row.attachmentsJson,
      }));
    },
    close() {
      database.close();
    },
  };
}
