import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import type { StoredMessage } from "../session-projections.js";
import { listStoredMessages } from "../session-projections.js";

export type SearchSessionMessagesInput = {
  sessionId: string;
  query: string;
};

export type SessionMessageSearchHit = StoredMessage & {
  lexicalSnippet: string;
};

export type SearchSessionMessagesResult = {
  sessionId: string;
  query: string;
  hits: SessionMessageSearchHit[];
};

function searchInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptySessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    searchInvalid("sessionId inválido para busca.");
  }
}

function requireNonEmptyQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0) {
    searchInvalid("query inválida para busca.");
  }
}

function sessionSearchable(database: DatabaseSync, sessionId: string): boolean {
  const row = database
    .prepare("SELECT id, deleted_at AS deletedAt FROM session WHERE id = ?")
    .get(sessionId) as { id?: string; deletedAt?: string | null } | undefined;
  return row?.id === sessionId && (row.deletedAt === null || row.deletedAt === undefined);
}

function buildFtsMatchExpression(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    searchInvalid("query inválida para busca.");
  }
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

function snippetFromLexicalText(lexicalText: string, query: string, maxLen = 120): string {
  const lowerText = lexicalText.toLowerCase();
  const firstToken = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const index = firstToken.length > 0 ? lowerText.indexOf(firstToken) : 0;
  const start = index >= 0 ? Math.max(0, index - 20) : 0;
  const slice = lexicalText.slice(start, start + maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLen < lexicalText.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

/**
 * Busca FTS5 nas mensagens projetadas de uma sessão (SES-05).
 */
export function searchSessionMessages(
  database: DatabaseSync,
  input: SearchSessionMessagesInput,
): SearchSessionMessagesResult {
  requireNonEmptySessionId(input.sessionId);
  requireNonEmptyQuery(input.query);

  if (!sessionSearchable(database, input.sessionId)) {
    searchInvalid("sessão inexistente ou removida para busca.", [input.sessionId]);
  }

  const matchExpression = buildFtsMatchExpression(input.query);
  let ftsRows: { messageId: string; lexicalText: string }[];
  try {
    ftsRows = database
      .prepare(
        `SELECT
          message_id AS messageId,
          lexical_text AS lexicalText
        FROM message_fts
        WHERE session_id = ? AND message_fts MATCH ?
        ORDER BY rowid`,
      )
      .all(input.sessionId, matchExpression) as { messageId: string; lexicalText: string }[];
  } catch {
    searchInvalid("query inválida para busca FTS.");
  }

  const messagesById = new Map(
    listStoredMessages(database, input.sessionId).map((message) => [message.id, message]),
  );

  const hits: SessionMessageSearchHit[] = [];
  for (const row of ftsRows) {
    const message = messagesById.get(row.messageId);
    if (!message) {
      continue;
    }
    hits.push({
      ...message,
      lexicalSnippet: snippetFromLexicalText(row.lexicalText, input.query),
    });
  }

  return {
    sessionId: input.sessionId,
    query: input.query,
    hits,
  };
}
