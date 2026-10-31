import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type RpcParamsMap,
  type RpcRequestEnvelope,
  type RpcMethod,
  type RpcResultMap,
} from "@openagent/protocol";
import {
  clearWorkspaceContextIndex, describeContextIndexSize, ensureContextChunkVectorSchema, ensureContextIndexSchema,
  executeContextAttachRpc, executeContextIndexRpc, executeContextSearchRpc,
  parseWorkspaceExclusionPatterns, purgeExcludedContextIndexPaths, resolveContextExclusionRuleset,
} from "@openagent/context";
import { openWorkspaceDatabase } from "@openagent/storage";
import type { SessionRpcContext } from "../sessions/session-rpc-handler.js";

function readWorkspaceContextLimit(
  sqlite: DatabaseSync,
  workspaceId: string,
): number | null {
  const row = sqlite
    .prepare(`SELECT context_limit AS contextLimit FROM workspace WHERE id = ?`)
    .get(workspaceId) as { contextLimit: number } | undefined;
  return row?.contextLimit ?? null;
}

export function dispatchContextRpc(
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
  const sqlite = new DatabaseSync(db.databasePath);
  try {
    const { workspaceRoot } = context.binding;
    sqlite.prepare(`INSERT OR IGNORE INTO workspace(id, root_path, exclusions_json, context_limit)
      VALUES (?, ?, '[]', 200000)`).run(workspaceId, workspaceRoot);
    ensureContextIndexSchema(sqlite);
    const row = sqlite.prepare("SELECT exclusions_json AS exclusions FROM workspace WHERE id = ?")
      .get(workspaceId) as { exclusions: string };
    const parsed = parseWorkspaceExclusionPatterns(row.exclusions);
    if (!parsed.valid) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Exclusões inválidas.");
    const options = { workspaceRoot, workspaceExclusionPatterns: parsed.patterns };
    switch (request.method) {
      case RPC_METHOD.CONTEXT_ATTACH:
        return executeContextAttachRpc(request.payload as RpcParamsMap[typeof RPC_METHOD.CONTEXT_ATTACH], {
          ...options, workspaceContextLimitTokens: readWorkspaceContextLimit(sqlite, workspaceId),
        });
      case RPC_METHOD.CONTEXT_INDEX: {
        const result = executeContextIndexRpc(
          sqlite, request.payload as RpcParamsMap[typeof RPC_METHOD.CONTEXT_INDEX], options,
        );
        // Se as regras mudaram durante a indexacao, expurga com a versao atual (nada excluido sobrevive).
        const current = readPersistedExclusions(sqlite, workspaceId);
        if (JSON.stringify(current) !== JSON.stringify(parsed.patterns)) {
          purgeExcludedContextIndexPaths(sqlite, {
            exclusionRuleset: resolveContextExclusionRuleset({ workspaceRoot, workspaceExclusionPatterns: current }),
          });
        }
        return result;
      }
      case RPC_METHOD.CONTEXT_SEARCH:
        return executeContextSearchRpc(sqlite, request.payload as RpcParamsMap[typeof RPC_METHOD.CONTEXT_SEARCH], options);
      case RPC_METHOD.CONTEXT_EXCLUSIONS_GET:
        return { patterns: parsed.patterns };
      case RPC_METHOD.CONTEXT_EXCLUSIONS_SET: {
        const patterns = (request.payload as RpcParamsMap[typeof RPC_METHOD.CONTEXT_EXCLUSIONS_SET]).patterns;
        const validated = parseWorkspaceExclusionPatterns(patterns);
        if (!validated.valid || new Set(validated.patterns).size !== validated.patterns.length) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Exclusões inválidas.");
        }
        const ruleset = resolveContextExclusionRuleset({ workspaceRoot, workspaceExclusionPatterns: validated.patterns });
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          sqlite.prepare("UPDATE workspace SET exclusions_json = ? WHERE id = ?")
            .run(JSON.stringify(validated.patterns), workspaceId);
          purgeExcludedContextIndexPaths(sqlite, { exclusionRuleset: ruleset });
          sqlite.exec("COMMIT");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
        return { patterns: validated.patterns };
      }
      case RPC_METHOD.CONTEXT_CLEAR_PREVIEW: {
        const size = describeContextIndexSize(sqlite);
        return { scope: "workspace", size, previewToken: indexToken(sqlite, workspaceId) };
      }
      case RPC_METHOD.CONTEXT_CLEAR: {
        const params = request.payload as RpcParamsMap[typeof RPC_METHOD.CONTEXT_CLEAR];
        if (params.scope !== "workspace" || !params.previewToken) {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Prévia e escopo são obrigatórios.");
        }
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          if (params.previewToken !== indexToken(sqlite, workspaceId)) {
            throw new ProtocolError(PROTOCOL_ERROR_CODES.CONFLICT, "Prévia do índice desatualizada.");
          }
          const result = clearWorkspaceContextIndex(sqlite);
          // Consome a previa: replay do mesmo token apos a limpeza retorna CONFLICT.
          sqlite.exec("UPDATE context_index_revision SET revision = revision + 1 WHERE id = 1");
          const sizeAfter = describeContextIndexSize(sqlite);
          sqlite.exec("COMMIT");
          return { cleared: true, ...result, sizeAfter };
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      }
      default:
        throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Método de contexto não implementado.");
    }
  } finally {
    sqlite.close();
    db.close();
  }
}

/** Token da previa: revisao do indice + identidade dos vetores, atado ao workspace. */
function indexToken(sqlite: DatabaseSync, workspaceId: string): string {
  ensureContextChunkVectorSchema(sqlite);
  const row = sqlite.prepare("SELECT revision FROM context_index_revision WHERE id = 1").get() as { revision: number };
  const hash = createHash("sha256").update(JSON.stringify([workspaceId, row.revision]));
  for (const vector of sqlite.prepare(
    "SELECT path, chunk_index, content_hash, vector_ref FROM context_chunk_embedding ORDER BY path, chunk_index",
  ).iterate()) {
    hash.update(JSON.stringify(vector));
  }
  return hash.digest("hex");
}

function readPersistedExclusions(sqlite: DatabaseSync, workspaceId: string): string[] {
  const row = sqlite.prepare("SELECT exclusions_json AS exclusions FROM workspace WHERE id = ?")
    .get(workspaceId) as { exclusions: string };
  const parsed = parseWorkspaceExclusionPatterns(row.exclusions);
  if (!parsed.valid) throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Exclusões inválidas.");
  return parsed.patterns;
}
