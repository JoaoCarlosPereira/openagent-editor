import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export type StoredMessage = {
  id: string;
  sessionId: string;
  role: string;
  status: string;
  contentRef: string;
  tokenCount: number;
};

export type StoredToolInvocation = {
  id: string;
  runId: string;
  tool: string;
  target: string;
  capability: string;
  state: string;
  resultRef: string | null;
};

export type StoredAgentNode = {
  id: string;
  runId: string;
  parentId: string | null;
  name: string;
  state: string;
  resultRef: string | null;
};

export type StoredQueueItem = {
  id: string;
  runId: string;
  ordinal: number;
  payloadRef: string;
  state: string;
};

function projectionInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    projectionInvalid(`${label} inválido.`);
  }
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

export function insertStoredMessage(
  database: DatabaseSync,
  message: StoredMessage,
): StoredMessage {
  requireNonEmptyString(message.id, "message.id");
  requireNonEmptyString(message.sessionId, "message.sessionId");
  requireNonEmptyString(message.role, "message.role");
  requireNonEmptyString(message.status, "message.status");
  requireNonEmptyString(message.contentRef, "message.contentRef");
  if (!Number.isInteger(message.tokenCount) || message.tokenCount < 0) {
    projectionInvalid("message.tokenCount inválido.");
  }
  if (!sessionExists(database, message.sessionId)) {
    projectionInvalid("sessionId inexistente para mensagem.", [message.sessionId]);
  }

  database
    .prepare(
      `INSERT INTO message(
        id, session_id, role, status, content_ref, token_count
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.id,
      message.sessionId,
      message.role,
      message.status,
      message.contentRef,
      message.tokenCount,
    );
  return message;
}

export function listStoredMessages(
  database: DatabaseSync,
  sessionId: string,
): StoredMessage[] {
  requireNonEmptyString(sessionId, "sessionId");
  const rows = database
    .prepare(
      `SELECT
        id,
        session_id AS sessionId,
        role,
        status,
        content_ref AS contentRef,
        token_count AS tokenCount
      FROM message
      WHERE session_id = ?
      ORDER BY id`,
    )
    .all(sessionId) as StoredMessage[];
  return rows;
}

export function insertStoredToolInvocation(
  database: DatabaseSync,
  invocation: StoredToolInvocation,
): StoredToolInvocation {
  requireNonEmptyString(invocation.id, "toolInvocation.id");
  requireNonEmptyString(invocation.runId, "toolInvocation.runId");
  requireNonEmptyString(invocation.tool, "toolInvocation.tool");
  requireNonEmptyString(invocation.target, "toolInvocation.target");
  requireNonEmptyString(invocation.capability, "toolInvocation.capability");
  requireNonEmptyString(invocation.state, "toolInvocation.state");
  if (!runExists(database, invocation.runId)) {
    projectionInvalid("runId inexistente para tool_invocation.", [invocation.runId]);
  }

  database
    .prepare(
      `INSERT INTO tool_invocation(
        id, run_id, tool, target, capability, state, result_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      invocation.id,
      invocation.runId,
      invocation.tool,
      invocation.target,
      invocation.capability,
      invocation.state,
      invocation.resultRef,
    );
  return invocation;
}

export function listStoredToolInvocations(
  database: DatabaseSync,
  runId: string,
): StoredToolInvocation[] {
  requireNonEmptyString(runId, "runId");
  return database
    .prepare(
      `SELECT
        id,
        run_id AS runId,
        tool,
        target,
        capability,
        state,
        result_ref AS resultRef
      FROM tool_invocation
      WHERE run_id = ?
      ORDER BY id`,
    )
    .all(runId) as StoredToolInvocation[];
}

export function insertStoredAgentNode(
  database: DatabaseSync,
  node: StoredAgentNode,
): StoredAgentNode {
  requireNonEmptyString(node.id, "agentNode.id");
  requireNonEmptyString(node.runId, "agentNode.runId");
  requireNonEmptyString(node.name, "agentNode.name");
  requireNonEmptyString(node.state, "agentNode.state");
  if (!runExists(database, node.runId)) {
    projectionInvalid("runId inexistente para agent_node.", [node.runId]);
  }
  if (node.parentId !== null) {
    const parent = database
      .prepare("SELECT id FROM agent_node WHERE id = ?")
      .get(node.parentId) as { id?: string } | undefined;
    if (parent?.id !== node.parentId) {
      projectionInvalid("parentId inexistente para agent_node.", [node.parentId]);
    }
  }

  database
    .prepare(
      `INSERT INTO agent_node(
        id, run_id, parent_id, name, state, result_ref
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(node.id, node.runId, node.parentId, node.name, node.state, node.resultRef);
  return node;
}

export function listStoredAgentNodes(
  database: DatabaseSync,
  runId: string,
): StoredAgentNode[] {
  requireNonEmptyString(runId, "runId");
  return database
    .prepare(
      `SELECT
        id,
        run_id AS runId,
        parent_id AS parentId,
        name,
        state,
        result_ref AS resultRef
      FROM agent_node
      WHERE run_id = ?
      ORDER BY id`,
    )
    .all(runId) as StoredAgentNode[];
}

export function insertStoredQueueItem(
  database: DatabaseSync,
  item: StoredQueueItem,
): StoredQueueItem {
  requireNonEmptyString(item.id, "queueItem.id");
  requireNonEmptyString(item.runId, "queueItem.runId");
  requireNonEmptyString(item.payloadRef, "queueItem.payloadRef");
  requireNonEmptyString(item.state, "queueItem.state");
  if (!Number.isInteger(item.ordinal) || item.ordinal < 0) {
    projectionInvalid("queueItem.ordinal inválido.");
  }
  if (!runExists(database, item.runId)) {
    projectionInvalid("runId inexistente para queue_item.", [item.runId]);
  }

  database
    .prepare(
      `INSERT INTO queue_item(id, run_id, ordinal, payload_ref, state)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(item.id, item.runId, item.ordinal, item.payloadRef, item.state);
  return item;
}

export function listStoredQueueItems(
  database: DatabaseSync,
  runId: string,
): StoredQueueItem[] {
  requireNonEmptyString(runId, "runId");
  return database
    .prepare(
      `SELECT
        id,
        run_id AS runId,
        ordinal,
        payload_ref AS payloadRef,
        state
      FROM queue_item
      WHERE run_id = ?
      ORDER BY ordinal`,
    )
    .all(runId) as StoredQueueItem[];
}

export type RemovePendingQueueItemResult = {
  runId: string;
  queueItemId: string;
  removed: boolean;
};

/** Remove item da fila apenas se ainda não iniciou (state = pending). */
export function removePendingQueueItem(
  database: DatabaseSync,
  runId: string,
  queueItemId: string,
): RemovePendingQueueItemResult {
  requireNonEmptyString(runId, "runId");
  requireNonEmptyString(queueItemId, "queueItemId");

  const row = database
    .prepare(
      `SELECT id, state FROM queue_item WHERE id = ? AND run_id = ?`,
    )
    .get(queueItemId, runId) as { id?: string; state?: string } | undefined;

  if (row?.id !== queueItemId) {
    projectionInvalid("item de fila inexistente.", [queueItemId]);
  }
  if (row.state !== "pending") {
    projectionInvalid("item de fila já iniciado não pode ser removido.", [
      queueItemId,
      row.state ?? "desconhecido",
    ]);
  }

  database.prepare("DELETE FROM queue_item WHERE id = ?").run(queueItemId);
  return { runId, queueItemId, removed: true };
}
