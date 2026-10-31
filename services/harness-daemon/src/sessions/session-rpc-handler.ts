import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type AgentMode,
  type RpcMethod,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcResultMap,
} from "@openagent/protocol";
import {
  createStoredSession,
  exportSessionTextFile,
  forkStoredSession,
  listStoredSessionsByWorkspace,
  openWorkspaceDatabase,
  searchSessionMessages,
  type WorkspaceDatabase,
} from "@openagent/storage";
import type { WorkspaceBindingState } from "../workspace-state.js";

export type SessionRpcContext = {
  dataRoot: string;
  binding: WorkspaceBindingState;
};

function isAgentMode(value: string): value is AgentMode {
  return value === "ask" || value === "plan" || value === "agent" || value === "debug";
}

function ensureWorkspaceRow(
  database: DatabaseSync,
  workspaceId: string,
  workspaceRoot: string,
): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path`,
    )
    .run(workspaceId, workspaceRoot, "[]", 200_000);
}

function resolveCasRoot(databasePath: string): string {
  return join(dirname(databasePath), "cas");
}

function withSqlite(
  db: WorkspaceDatabase,
  run: (sqlite: DatabaseSync, casRoot: string) => void,
): void {
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    run(sqlite, resolveCasRoot(db.databasePath));
  } finally {
    sqlite.close();
  }
}

function mapProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message);
}

export function handleSessionRpc(
  context: SessionRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  const { workspaceId } = context.binding;
  if (request.workspaceId !== workspaceId) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "workspaceId da requisição não corresponde ao workspace da conexão.",
      [request.workspaceId, workspaceId],
    );
  }

  const db = openWorkspaceDatabase({ dataRoot: context.dataRoot, workspaceId });
  try {
    switch (request.method) {
      case RPC_METHOD.SESSION_CREATE:
        return handleSessionCreate(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_CREATE>,
        );
      case RPC_METHOD.SESSION_LIST:
        return handleSessionList(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_LIST>,
        );
      case RPC_METHOD.SESSION_SEARCH:
        return handleSessionSearch(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_SEARCH>,
        );
      case RPC_METHOD.SESSION_EXPORT:
        return handleSessionExport(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_EXPORT>,
        );
      case RPC_METHOD.SESSION_DELETE:
        return handleSessionDelete(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_DELETE>,
        );
      case RPC_METHOD.SESSION_FORK:
        return handleSessionFork(
          context,
          db,
          request as RpcRequestEnvelope<typeof RPC_METHOD.SESSION_FORK>,
        );
      default:
        throw new ProtocolError(
          PROTOCOL_ERROR_CODES.INVALID_STATE,
          `Método RPC não implementado no daemon: ${String(request.method)}`,
        );
    }
  } finally {
    db.close();
  }
}

function handleSessionCreate(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_CREATE>,
): RpcResultMap[typeof RPC_METHOD.SESSION_CREATE] {
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.SESSION_CREATE];
  const mode = params.mode ?? (isAgentMode(context.binding.mode) ? context.binding.mode : "agent");
  const sessionId = `ses-${randomUUID()}`;

  const rulesSnapshot = context.customizationRules.beginSession({
    workspaceRoot: context.binding.workspaceRoot,
    sessionId,
    rulesRef: context.binding.rulesRef,
  });

  withSqlite(db, (sqlite) => {
    ensureWorkspaceRow(sqlite, context.binding.workspaceId, context.binding.workspaceRoot);
    createStoredSession(sqlite, {
      sessionId,
      workspaceId: context.binding.workspaceId,
      mode,
    });
  });

  if (!context.binding.sessionIds.includes(sessionId)) {
    context.binding.sessionIds.push(sessionId);
  }

  return {
    sessionId,
    workspaceId: context.binding.workspaceId,
    mode,
  };
}

function handleSessionList(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_LIST>,
): RpcResultMap[typeof RPC_METHOD.SESSION_LIST] {
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.SESSION_LIST];
  const limit = params.limit ?? 100;

  let sessions: Array<{ sessionId: string; mode: AgentMode }> = [];
  withSqlite(db, (sqlite) => {
    let stored = listStoredSessionsByWorkspace(sqlite, context.binding.workspaceId);
    if (params.cursor) {
      const cursorIndex = stored.findIndex((row) => row.id === params.cursor);
      if (cursorIndex >= 0) {
        stored = stored.slice(cursorIndex + 1);
      }
    }
    sessions = stored.slice(0, limit).map((row) => ({
      sessionId: row.id,
      mode: isAgentMode(row.mode) ? row.mode : "agent",
    }));
  });

  return { sessions };
}

function handleSessionSearch(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_SEARCH>,
): RpcResultMap[typeof RPC_METHOD.SESSION_SEARCH] {
  const params = request.payload as RpcParamsMap[typeof RPC_METHOD.SESSION_SEARCH];
  const sessionId = request.sessionId;

  let sessions: Array<{ sessionId: string; mode: AgentMode }> = [];
  withSqlite(db, (sqlite) => {
    const result = searchSessionMessages(sqlite, {
      sessionId,
      query: params.query,
    });
    if (result.hits.length === 0) {
      return;
    }
    const modeRow = sqlite
      .prepare("SELECT mode FROM session WHERE id = ?")
      .get(sessionId) as { mode?: string } | undefined;
    const mode = modeRow?.mode && isAgentMode(modeRow.mode) ? modeRow.mode : "agent";
    sessions = [{ sessionId, mode }];
  });

  return { sessions };
}

function handleSessionExport(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_EXPORT>,
): RpcResultMap[typeof RPC_METHOD.SESSION_EXPORT] {
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.SESSION_EXPORT];
  if (params.format !== undefined && params.format !== "text") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Apenas exportação text está disponível nesta versão.",
    );
  }

  const sessionId = request.sessionId;
  const exportDir = join(dirname(db.databasePath), "exports");
  mkdirSync(exportDir, { recursive: true });
  const outputPath = join(exportDir, `${sessionId}.txt`);

  withSqlite(db, (sqlite, casRoot) => {
    exportSessionTextFile(sqlite, casRoot, { sessionId, outputPath });
  });

  return { exportRef: outputPath };
}

function handleSessionDelete(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_DELETE>,
): RpcResultMap[typeof RPC_METHOD.SESSION_DELETE] {
  const sessionId = request.sessionId;
  db.deleteSession(sessionId);
  context.binding.sessionIds = context.binding.sessionIds.filter((id) => id !== sessionId);
  return { deleted: true };
}

function handleSessionFork(
  context: SessionRpcContext,
  db: WorkspaceDatabase,
  request: RpcRequestEnvelope<typeof RPC_METHOD.SESSION_FORK>,
): RpcResultMap[typeof RPC_METHOD.SESSION_FORK] {
  const params = (request.payload ?? {}) as RpcParamsMap[typeof RPC_METHOD.SESSION_FORK];
  const parentSessionId = request.sessionId;
  const forkSessionId = params.branchId?.trim() || `ses-fork-${randomUUID()}`;

  withSqlite(db, (sqlite) => {
    forkStoredSession(sqlite, { parentSessionId, forkSessionId });
  });

  if (!context.binding.sessionIds.includes(forkSessionId)) {
    context.binding.sessionIds.push(forkSessionId);
  }

  return { sessionId: forkSessionId, parentSessionId };
}

export function dispatchSessionRpc(
  context: SessionRpcContext,
  request: RpcRequestEnvelope,
): RpcResultMap[RpcMethod] {
  try {
    return handleSessionRpc(context, request);
  } catch (error) {
    throw mapProtocolError(error);
  }
}
