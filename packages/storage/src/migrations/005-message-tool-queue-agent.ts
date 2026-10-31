import type { DatabaseSync } from "node:sqlite";
import type { StorageMigration } from "../migration-runner.js";
import { STORAGE_SCHEMA_VERSION } from "../schema-version.js";

const MESSAGE_TOOL_QUEUE_AGENT_SQL = `
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES session(id)
);

CREATE TABLE IF NOT EXISTS tool_invocation (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT NOT NULL,
  capability TEXT NOT NULL,
  state TEXT NOT NULL,
  result_ref TEXT,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE TABLE IF NOT EXISTS agent_node (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  result_ref TEXT,
  FOREIGN KEY (run_id) REFERENCES run(id),
  FOREIGN KEY (parent_id) REFERENCES agent_node(id)
);

CREATE TABLE IF NOT EXISTS queue_item (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload_ref TEXT NOT NULL,
  state TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run(id)
);

CREATE INDEX IF NOT EXISTS idx_message_session_id ON message(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_invocation_run_id ON tool_invocation(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_node_run_id ON agent_node(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_item_run_ordinal ON queue_item(run_id, ordinal);
`;

export const migration005MessageToolQueueAgent: StorageMigration = {
  version: 5,
  description: "message, tool_invocation, queue_item e agent_node (SES-01, AGT-05, AGT-06)",
  up(database: DatabaseSync) {
    database.exec(MESSAGE_TOOL_QUEUE_AGENT_SQL);
    database
      .prepare(
        `INSERT INTO storage_meta(key, value) VALUES('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(STORAGE_SCHEMA_VERSION));
  },
};
