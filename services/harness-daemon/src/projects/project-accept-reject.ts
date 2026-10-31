import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type RpcParamsMap,
  type RpcResultMap,
  RPC_METHOD,
} from "@openagent/protocol";
import { persistHarnessEventWithPayload } from "@openagent/policy";
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  loadAgentNodeRow,
  updateAgentNodeState,
} from "../agents/agent-node-db.js";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export const PROJECT_ACCEPTED_EVENT = "project.accepted";
export const PROJECT_REJECTED_EVENT = "project.rejected";

export type ProjectReviewDecision = "accepted" | "rejected";

type ProjectResultPayload = {
  projectId?: string;
  agentId?: string;
  objective?: string;
  summary?: string;
  reviewStatus?: string;
  [key: string]: unknown;
};

function parsePendingResult(
  db: ReturnType<typeof openWorkspaceDatabase>,
  resultRef: string,
  nodeId: string,
): ProjectResultPayload {
  let raw: string;
  try {
    raw = Buffer.from(db.readCasBlob(resultRef)).toString("utf8");
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "resultRef CAS inexistente para revisão de projeto.",
      [nodeId, resultRef],
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "resultado de projeto não é JSON válido.",
      [nodeId],
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "resultado de projeto com formato inválido.",
      [nodeId],
    );
  }

  return parsed as ProjectResultPayload;
}

/**
 * PRJ-01: aceita ou rejeita o resultado de uma tarefa de projeto (AgentNode filho).
 */
export function reviewProjectNodeResult(
  context: DaemonRpcContext,
  runId: string,
  nodeId: string,
  decision: ProjectReviewDecision,
):
  | RpcResultMap[typeof RPC_METHOD.PROJECT_ACCEPT]
  | RpcResultMap[typeof RPC_METHOD.PROJECT_REJECT] {
  const trimmedNodeId = nodeId.trim();
  if (trimmedNodeId.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "nodeId inválido para revisão de projeto.",
    );
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const node = loadAgentNodeRow(db, trimmedNodeId);
    if (!node) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "nodeId inexistente para revisão de projeto.",
        [trimmedNodeId],
      );
    }
    if (node.run_id !== runId) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "nodeId não pertence ao run da requisição.",
        [trimmedNodeId, runId],
      );
    }
    if (node.parent_id === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "somente resultados de tarefas do projeto (não o coordenador) podem ser revisados.",
        [trimmedNodeId],
      );
    }
    if (node.state !== "complete" || !node.result_ref) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "resultado do projeto ainda não está pronto para revisão.",
        [trimmedNodeId, node.state],
      );
    }

    const previousResultRef = node.result_ref;
    const payload = parsePendingResult(db, previousResultRef, trimmedNodeId);
    const currentStatus = payload.reviewStatus;
    if (currentStatus !== "pending") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        currentStatus === "accepted" || currentStatus === "rejected"
          ? `resultado do projeto já foi ${currentStatus}.`
          : "resultado do projeto sem reviewStatus pendente.",
        [trimmedNodeId, String(currentStatus ?? "")],
      );
    }

    const reviewStatus = decision;
    const nextPayload: ProjectResultPayload = {
      ...payload,
      projectId:
        typeof payload.projectId === "string" && payload.projectId.trim().length > 0
          ? payload.projectId
          : node.parent_id,
      agentId: trimmedNodeId,
      reviewStatus,
    };
    const nextCas = db.putCasBlob(Buffer.from(JSON.stringify(nextPayload), "utf8"));
    updateAgentNodeState(db, trimmedNodeId, "complete", nextCas.contentRef);

    const eventType =
      decision === "accepted" ? PROJECT_ACCEPTED_EVENT : PROJECT_REJECTED_EVENT;
    persistHarnessEventWithPayload(db, runId, eventType, {
      projectId: nextPayload.projectId,
      nodeId: trimmedNodeId,
      agentId: trimmedNodeId,
      name: node.name,
      reviewStatus,
      resultRef: nextCas.contentRef,
      previousResultRef,
    });

    if (decision === "accepted") {
      return { accepted: true };
    }
    return { rejected: true };
  } finally {
    db.close();
  }
}

export function handleProjectAccept(
  context: DaemonRpcContext,
  runId: string,
  params: RpcParamsMap[typeof RPC_METHOD.PROJECT_ACCEPT],
): RpcResultMap[typeof RPC_METHOD.PROJECT_ACCEPT] {
  return reviewProjectNodeResult(context, runId, params.nodeId, "accepted") as RpcResultMap[
    typeof RPC_METHOD.PROJECT_ACCEPT
  ];
}

export function handleProjectReject(
  context: DaemonRpcContext,
  runId: string,
  params: RpcParamsMap[typeof RPC_METHOD.PROJECT_REJECT],
): RpcResultMap[typeof RPC_METHOD.PROJECT_REJECT] {
  return reviewProjectNodeResult(context, runId, params.nodeId, "rejected") as RpcResultMap[
    typeof RPC_METHOD.PROJECT_REJECT
  ];
}
