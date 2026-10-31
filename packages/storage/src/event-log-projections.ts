import type { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateHarnessEventStream,
  type HarnessEvent,
} from "@openagent/protocol";
import { readCasBlob } from "./cas.js";
import { listHarnessEvents } from "./event-log.js";
import {
  insertStoredMessage,
  insertStoredToolInvocation,
  listStoredMessages,
  listStoredToolInvocations,
  type StoredMessage,
  type StoredToolInvocation,
} from "./session-projections.js";

export type RebuildProjectionsFromEventLogResult = {
  sessionId: string;
  appliedEventCount: number;
  mode: string;
};

function projectionInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function readJsonPayload(
  database: DatabaseSync,
  casRoot: string,
  payloadRef: string,
): unknown {
  const bytes = readCasBlob(database, casRoot, payloadRef);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    projectionInvalid("payloadRef JSON inválido.", [payloadRef]);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    projectionInvalid(`${label} inválido.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    projectionInvalid(`${label} inválido.`);
  }
  return value;
}

function sessionExists(database: DatabaseSync, sessionId: string): boolean {
  const row = database
    .prepare("SELECT id FROM session WHERE id = ?")
    .get(sessionId) as { id?: string } | undefined;
  return row?.id === sessionId;
}

function runExists(database: DatabaseSync, runId: string): boolean {
  const row = database
    .prepare("SELECT id FROM run WHERE id = ?")
    .get(runId) as { id?: string } | undefined;
  return row?.id === runId;
}

function sessionIdForRun(database: DatabaseSync, runId: string): string {
  const row = database
    .prepare("SELECT session_id AS sessionId FROM run WHERE id = ?")
    .get(runId) as { sessionId?: string } | undefined;
  if (!row?.sessionId) {
    projectionInvalid("runId inexistente para projeção.", [runId]);
  }
  return row.sessionId;
}

function listRunIdsForSession(database: DatabaseSync, sessionId: string): string[] {
  const rows = database
    .prepare("SELECT id FROM run WHERE session_id = ? ORDER BY id")
    .all(sessionId) as { id: string }[];
  return rows.map((row) => row.id);
}

function parseStoredMessage(raw: unknown, sessionId: string): StoredMessage {
  const obj = requireObject(raw, "message");
  if (
    typeof obj.tokenCount !== "number" ||
    !Number.isInteger(obj.tokenCount) ||
    obj.tokenCount < 0
  ) {
    projectionInvalid("message.tokenCount inválido.");
  }
  return {
    id: requireNonEmptyString(obj.id, "message.id"),
    sessionId,
    role: requireNonEmptyString(obj.role, "message.role"),
    status: requireNonEmptyString(obj.status, "message.status"),
    contentRef: requireNonEmptyString(obj.contentRef, "message.contentRef"),
    tokenCount: obj.tokenCount,
  };
}

function parseStoredToolInvocation(raw: unknown, runId: string): StoredToolInvocation {
  const obj = requireObject(raw, "toolInvocation");
  const resultRef = obj.resultRef;
  return {
    id: requireNonEmptyString(obj.id, "toolInvocation.id"),
    runId,
    tool: requireNonEmptyString(obj.tool, "toolInvocation.tool"),
    target: requireNonEmptyString(obj.target, "toolInvocation.target"),
    capability: requireNonEmptyString(obj.capability, "toolInvocation.capability"),
    state: requireNonEmptyString(obj.state, "toolInvocation.state"),
    resultRef:
      resultRef === null || resultRef === undefined
        ? null
        : requireNonEmptyString(resultRef, "toolInvocation.resultRef"),
  };
}

function clearSessionProjections(database: DatabaseSync, sessionId: string): void {
  const runIds = listRunIdsForSession(database, sessionId);
  database.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
  for (const runId of runIds) {
    database.prepare("DELETE FROM tool_invocation WHERE run_id = ?").run(runId);
  }
  database.prepare("DELETE FROM session_resume WHERE session_id = ?").run(sessionId);
}

function updateSessionMode(database: DatabaseSync, sessionId: string, mode: string): void {
  if (!sessionExists(database, sessionId)) {
    projectionInvalid("sessionId inexistente para projeção.", [sessionId]);
  }
  database.prepare("UPDATE session SET mode = ? WHERE id = ?").run(mode, sessionId);
}

function replaceSessionMessages(
  database: DatabaseSync,
  sessionId: string,
  messages: StoredMessage[],
): void {
  database.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
  for (const message of messages) {
    insertStoredMessage(database, message);
  }
}

function upsertToolInvocation(database: DatabaseSync, invocation: StoredToolInvocation): void {
  database.prepare("DELETE FROM tool_invocation WHERE id = ?").run(invocation.id);
  insertStoredToolInvocation(database, invocation);
}

function syncSessionResume(
  database: DatabaseSync,
  sessionId: string,
  mode: string,
  attachments: unknown[],
): void {
  const messages = listStoredMessages(database, sessionId);
  const runIds = listRunIdsForSession(database, sessionId);
  const tools: StoredToolInvocation[] = [];
  for (const runId of runIds) {
    tools.push(...listStoredToolInvocations(database, runId));
  }

  const messagesJson = JSON.stringify(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      status: message.status,
      contentRef: message.contentRef,
      tokenCount: message.tokenCount,
    })),
  );
  const toolsJson = JSON.stringify(
    tools.map((tool) => ({
      id: tool.id,
      runId: tool.runId,
      tool: tool.tool,
      target: tool.target,
      capability: tool.capability,
      state: tool.state,
      resultRef: tool.resultRef,
    })),
  );
  const attachmentsJson = JSON.stringify(attachments);

  database
    .prepare(
      `INSERT INTO session_resume(
        session_id, mode, messages_json, tools_json, attachments_json
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        mode = excluded.mode,
        messages_json = excluded.messages_json,
        tools_json = excluded.tools_json,
        attachments_json = excluded.attachments_json`,
    )
    .run(sessionId, mode, messagesJson, toolsJson, attachmentsJson);
}

type ApplyContext = {
  mode: string;
  attachments: unknown[];
};

function applySessionResumed(
  database: DatabaseSync,
  casRoot: string,
  event: HarnessEvent,
  context: ApplyContext,
): void {
  const payload = requireObject(readJsonPayload(database, casRoot, event.payloadRef), "session.resumed");
  const sessionId = requireNonEmptyString(payload.sessionId, "sessionId");
  const mode = requireNonEmptyString(payload.mode, "mode");
  updateSessionMode(database, sessionId, mode);
  context.mode = mode;

  const rawMessages = payload.messages;
  if (rawMessages !== undefined) {
    if (!Array.isArray(rawMessages)) {
      projectionInvalid("session.resumed.messages inválido.");
    }
    const messages = rawMessages.map((item) => parseStoredMessage(item, sessionId));
    replaceSessionMessages(database, sessionId, messages);
  }

  const rawTools = payload.tools;
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      projectionInvalid("session.resumed.tools inválido.");
    }
    for (const item of rawTools) {
      const invocation = parseStoredToolInvocation(item, event.runId);
      upsertToolInvocation(database, invocation);
    }
  }

  const rawAttachments = payload.attachments;
  if (rawAttachments !== undefined) {
    if (!Array.isArray(rawAttachments)) {
      projectionInvalid("session.resumed.attachments inválido.");
    }
    context.attachments = rawAttachments;
  }
}

function applySessionMode(
  database: DatabaseSync,
  casRoot: string,
  event: HarnessEvent,
  context: ApplyContext,
): void {
  const payload = requireObject(readJsonPayload(database, casRoot, event.payloadRef), "session.mode");
  const sessionId = requireNonEmptyString(payload.sessionId, "sessionId");
  const mode = requireNonEmptyString(payload.mode, "mode");
  if (sessionIdForRun(database, event.runId) !== sessionId) {
    projectionInvalid("session.mode não corresponde ao runId do evento.", [event.runId, sessionId]);
  }
  updateSessionMode(database, sessionId, mode);
  context.mode = mode;
}

function applyMessageSnapshot(
  database: DatabaseSync,
  casRoot: string,
  event: HarnessEvent,
): void {
  const payload = requireObject(
    readJsonPayload(database, casRoot, event.payloadRef),
    "message.snapshot",
  );
  const sessionId = requireNonEmptyString(payload.sessionId, "sessionId");
  if (sessionIdForRun(database, event.runId) !== sessionId) {
    projectionInvalid("message.snapshot não corresponde ao runId do evento.", [
      event.runId,
      sessionId,
    ]);
  }
  const rawMessages = payload.messages;
  if (!Array.isArray(rawMessages)) {
    projectionInvalid("message.snapshot.messages inválido.");
  }
  const messages = rawMessages.map((item) => parseStoredMessage(item, sessionId));
  replaceSessionMessages(database, sessionId, messages);
}

function applyToolResult(database: DatabaseSync, casRoot: string, event: HarnessEvent): void {
  const payload = requireObject(readJsonPayload(database, casRoot, event.payloadRef), "tool.result");
  const runId = requireNonEmptyString(payload.runId ?? event.runId, "runId");
  if (runId !== event.runId) {
    projectionInvalid("tool.result runId diverge do evento.", [event.runId, runId]);
  }
  if (!runExists(database, runId)) {
    projectionInvalid("runId inexistente para tool.result.", [runId]);
  }
  const invocation = parseStoredToolInvocation(payload.invocation, runId);
  upsertToolInvocation(database, invocation);
}

function applyAttachmentRetained(
  database: DatabaseSync,
  casRoot: string,
  event: HarnessEvent,
  context: ApplyContext,
): void {
  const payload = requireObject(
    readJsonPayload(database, casRoot, event.payloadRef),
    "attachment.retained",
  );
  const sessionId = requireNonEmptyString(payload.sessionId, "sessionId");
  if (sessionIdForRun(database, event.runId) !== sessionId) {
    projectionInvalid("attachment.retained não corresponde ao runId do evento.", [
      event.runId,
      sessionId,
    ]);
  }
  const rawAttachments = payload.attachments;
  if (!Array.isArray(rawAttachments)) {
    projectionInvalid("attachment.retained.attachments inválido.");
  }
  context.attachments = rawAttachments;
}

/**
 * Aplica um evento do log às projeções materializadas (mensagens, ferramentas, modo, anexos).
 */
export function applyHarnessEventToProjections(
  database: DatabaseSync,
  casRoot: string,
  event: HarnessEvent,
  context: ApplyContext,
): void {
  switch (event.type) {
    case "session.resumed":
      applySessionResumed(database, casRoot, event, context);
      break;
    case "session.mode":
      applySessionMode(database, casRoot, event, context);
      break;
    case "message.snapshot":
      applyMessageSnapshot(database, casRoot, event);
      break;
    case "tool.result":
      applyToolResult(database, casRoot, event);
      break;
    case "attachment.retained":
      applyAttachmentRetained(database, casRoot, event, context);
      break;
    default:
      break;
  }
}

function readSessionMode(database: DatabaseSync, sessionId: string): string {
  const row = database
    .prepare("SELECT mode FROM session WHERE id = ?")
    .get(sessionId) as { mode?: string } | undefined;
  if (!row?.mode) {
    projectionInvalid("sessionId inexistente para reconstrução.", [sessionId]);
  }
  return row.mode;
}

/**
 * Reconstrói projeções da sessão a partir do event log append-only (SES-01).
 */
export function rebuildProjectionsFromEventLog(
  database: DatabaseSync,
  casRoot: string,
  sessionId: string,
): RebuildProjectionsFromEventLogResult {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    projectionInvalid("sessionId inválido para reconstrução.");
  }
  if (!sessionExists(database, sessionId)) {
    projectionInvalid("sessionId inexistente para reconstrução.", [sessionId]);
  }

  const runIdSet = new Set(listRunIdsForSession(database, sessionId));
  const events = listHarnessEvents(database).filter((event) => runIdSet.has(event.runId));
  const streamCheck = validateHarnessEventStream(events);
  if (!streamCheck.valid) {
    projectionInvalid("event log inválido para reconstrução.", streamCheck.errors);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    clearSessionProjections(database, sessionId);
    const context: ApplyContext = {
      mode: readSessionMode(database, sessionId),
      attachments: [],
    };

    for (const event of events) {
      applyHarnessEventToProjections(database, casRoot, event, context);
    }

    syncSessionResume(database, sessionId, context.mode, context.attachments);

    database.exec("COMMIT");
    return {
      sessionId,
      appliedEventCount: events.length,
      mode: context.mode,
    };
  } catch (cause) {
    database.exec("ROLLBACK");
    if (cause instanceof ProtocolError) {
      throw cause;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    projectionInvalid("falha ao reconstruir projeções.", [detail]);
  }
}

export function syncSessionResumeProjection(
  database: DatabaseSync,
  sessionId: string,
  context: ApplyContext,
): void {
  syncSessionResume(database, sessionId, context.mode, context.attachments);
}

export type { ApplyContext };
