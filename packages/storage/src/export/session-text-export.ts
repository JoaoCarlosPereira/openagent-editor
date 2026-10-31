import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { readCasBlob } from "../cas.js";
import { listStoredMessages } from "../session-projections.js";

export type ExportSessionTextFileInput = {
  sessionId: string;
  outputPath: string;
};

export type ExportSessionTextFileResult = {
  sessionId: string;
  outputPath: string;
  messageCount: number;
  byteSize: number;
};

function exportInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptySessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    exportInvalid("sessionId inválido para exportação.");
  }
}

function requireNonEmptyOutputPath(outputPath: string): void {
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    exportInvalid("outputPath inválido para exportação.");
  }
}

function sessionActive(database: DatabaseSync, sessionId: string): boolean {
  const row = database
    .prepare("SELECT id, deleted_at AS deletedAt FROM session WHERE id = ?")
    .get(sessionId) as { id?: string; deletedAt?: string | null } | undefined;
  return row?.id === sessionId && (row.deletedAt === null || row.deletedAt === undefined);
}

type ResumeMessageRow = {
  messagesJson: string;
};

function loadResumeMessagesJson(database: DatabaseSync, sessionId: string): string | null {
  const row = database
    .prepare("SELECT messages_json AS messagesJson FROM session_resume WHERE session_id = ?")
    .get(sessionId) as ResumeMessageRow | undefined;
  return row?.messagesJson ?? null;
}

function parseMessagesJson(jsonText: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    exportInvalid("messages_json inválido para exportação.");
  }
  if (!Array.isArray(parsed)) {
    exportInvalid("messages_json inválido para exportação: esperado array.");
  }
  return parsed;
}

function textFromCasContentRef(
  database: DatabaseSync,
  casRoot: string,
  contentRef: string,
): string {
  const bytes = readCasBlob(database, casRoot, contentRef);
  const raw = Buffer.from(bytes).toString("utf8");
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    // Conteúdo textual bruto no CAS.
  }
  return raw;
}

function resolveMessageBody(
  database: DatabaseSync,
  casRoot: string,
  entry: unknown,
): { role: string; body: string } {
  if (typeof entry !== "object" || entry === null) {
    exportInvalid("mensagem inválida para exportação.");
  }
  const record = entry as Record<string, unknown>;
  const role = typeof record.role === "string" && record.role.length > 0 ? record.role : "unknown";

  if (typeof record.text === "string") {
    return { role, body: record.text };
  }

  if (typeof record.contentRef === "string" && record.contentRef.length > 0) {
    return { role, body: textFromCasContentRef(database, casRoot, record.contentRef) };
  }

  exportInvalid("mensagem sem texto exportável.", [role]);
}

function formatExportText(lines: { role: string; body: string }[]): string {
  return lines
    .map(({ role, body }) => `[${role}]\n${body}`)
    .join("\n\n")
    .concat(lines.length > 0 ? "\n" : "");
}

function collectExportLines(
  database: DatabaseSync,
  casRoot: string,
  sessionId: string,
): { role: string; body: string }[] {
  const projected = listStoredMessages(database, sessionId);
  if (projected.length > 0) {
    return projected.map((message) => ({
      role: message.role,
      body: textFromCasContentRef(database, casRoot, message.contentRef),
    }));
  }

  const messagesJson = loadResumeMessagesJson(database, sessionId);
  if (messagesJson === null) {
    exportInvalid("sessão inexistente para exportação.", [sessionId]);
  }

  const entries = parseMessagesJson(messagesJson);
  return entries.map((entry) => resolveMessageBody(database, casRoot, entry));
}

/**
 * Grava arquivo de texto UTF-8 com as mensagens da sessão (SES-02).
 */
export function exportSessionTextFile(
  database: DatabaseSync,
  casRoot: string,
  input: ExportSessionTextFileInput,
): ExportSessionTextFileResult {
  requireNonEmptySessionId(input.sessionId);
  requireNonEmptyOutputPath(input.outputPath);

  if (!sessionActive(database, input.sessionId)) {
    exportInvalid("sessão inexistente ou removida para exportação.", [input.sessionId]);
  }

  const lines = collectExportLines(database, casRoot, input.sessionId);
  const text = formatExportText(lines);
  const bytes = Buffer.from(text, "utf8");

  try {
    mkdirSync(dirname(input.outputPath), { recursive: true });
    writeFileSync(input.outputPath, bytes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    exportInvalid("falha ao gravar arquivo de exportação.", [detail]);
  }

  return {
    sessionId: input.sessionId,
    outputPath: input.outputPath,
    messageCount: lines.length,
    byteSize: bytes.byteLength,
  };
}
