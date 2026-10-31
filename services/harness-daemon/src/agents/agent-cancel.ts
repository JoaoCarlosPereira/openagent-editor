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
  loadRunLifecycleState,
  updateAgentNodeState,
} from "./agent-node-db.js";
import {
  abortSubagentRun,
  unregisterSubagentRun,
} from "./agent-subagent-runtime.js";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";

export const AGENT_CANCELLED_EVENT = "agent.cancelled";

function assertCancelPreconditions(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
): { name: string; state: string } {
  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const lifecycle = loadRunLifecycleState(db, runId);
    if (lifecycle === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "runId inexistente para agent.cancel.",
        [runId],
      );
    }
    if (lifecycle !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Subagente só pode ser cancelado com execução em andamento.",
        [runId, lifecycle],
      );
    }

    const node = loadAgentNodeRow(db, agentId);
    if (node === null) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "agentId inexistente para agent.cancel.",
        [agentId],
      );
    }
    if (node.run_id !== runId) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "agentId não pertence ao run informado.",
        [agentId, runId],
      );
    }
    if (node.state === "complete") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Subagente já concluído; cancelamento não aplicável.",
        [agentId],
      );
    }
    if (node.state === "cancelled") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Subagente já cancelado.",
        [agentId],
      );
    }
    if (node.state !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        `Estado de subagente inválido para cancelamento: ${node.state}`,
        [agentId],
      );
    }
    return { name: node.name, state: node.state };
  } finally {
    db.close();
  }
}

/**
 * AGT-07: interrompe só o subagente indicado, sem alterar os demais no mesmo run.
 */
export function cancelSubagentById(
  context: DaemonRpcContext,
  runId: string,
  agentId: string,
): RpcResultMap[typeof RPC_METHOD.AGENT_CANCEL] {
  const { name } = assertCancelPreconditions(context, runId, agentId);

  abortSubagentRun(context, runId, agentId);

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const node = loadAgentNodeRow(db, agentId);
    if (node?.state !== "running") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Subagente não está em execução para cancelamento.",
        [agentId, node?.state ?? "missing"],
      );
    }

    updateAgentNodeState(db, agentId, "cancelled", null);
    persistHarnessEventWithPayload(db, runId, AGENT_CANCELLED_EVENT, {
      agentId,
      name,
    });
  } finally {
    db.close();
    unregisterSubagentRun(context, runId, agentId);
  }

  return { cancelled: true };
}

export function handleAgentCancel(
  context: DaemonRpcContext,
  runId: string,
  params: RpcParamsMap[typeof RPC_METHOD.AGENT_CANCEL],
): RpcResultMap[typeof RPC_METHOD.AGENT_CANCEL] {
  return cancelSubagentById(context, runId, params.agentId);
}
