import type { DatabaseSync } from "node:sqlite";

export type MessageFtsIndexInput = {
  messageId: string;
  sessionId: string;
  lexicalText: string;
};

export function indexMessageFts(database: DatabaseSync, input: MessageFtsIndexInput): void {
  database
    .prepare(
      `INSERT INTO message_fts(lexical_text, message_id, session_id)
       VALUES (?, ?, ?)`,
    )
    .run(input.lexicalText, input.messageId, input.sessionId);
}

export function removeMessageFtsForSession(database: DatabaseSync, sessionId: string): void {
  database.prepare("DELETE FROM message_fts WHERE session_id = ?").run(sessionId);
}
