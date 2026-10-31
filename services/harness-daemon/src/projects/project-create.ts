import { randomUUID } from "node:crypto";
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
  AGENT_COMPLETED_EVENT,
  AGENT_SPAWNED_EVENT,
} from "../agents/agent-spawn.js";
import {
  loadAgentNodeRow,
  loadRunLifecycleState,
  updateAgentNodeState,
} from "../agents/agent-node-db.js";
import {
  registerSubagentRun,
  unregisterSubagentRun,
  waitAbortableMs,
} from "../agents/agent-subagent-runtime.js";
import type { DaemonRpcContext } from "../runs/run-rpc-handler.js";
import { divideObjectiveIntoAgentTasks } from "./divide-objective.js";

export const PROJECT_CREATED_EVENT = "project.created";

const COORDINATOR_NAME_MAX = 200;

function coordinatorDisplayName(objective: string): string {
  const label = `Coordenador: ${objective.trim()}`;
  if (label.length <= COORDINATOR_NAME_MAX) {
    return label;
  }
  return `${label.slice(0, COORDINATOR_NAME_MAX - 1)}…`;
}

function taskDisplayName(task: string): string {
  const trimmed = task.trim();
  if (trimmed.length <= COORDINATOR_NAME_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, COORDINATOR_NAME_MAX - 1)}…`;
}

function assertProjectCreatePreconditions(
  context: DaemonRpcContext,
  runId: string,
  db: ReturnType<typeof openWorkspaceDatabase>,
): void {
  const lifecycle = loadRunLifecycleState(db, runId);
  if (lifecycle === null) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "runId inexistente para project.create.",
      [runId],
    );
  }
  if (lifecycle !== "running") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Projeto só pode ser criado com execução em andamento.",
      [runId, lifecycle],
    );
  }
  if (context.binding.workspaceId.trim().length === 0) {
    throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "workspaceId inválido.");
  }
}

async function completeProjectTaskAgent(
  context: DaemonRpcContext,
  runId: string,
  projectId: string,
  agentId: string,
  taskObjective: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await waitAbortableMs(0, signal);
  } catch (error) {
    if (error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.CANCELLED) {
      return;
    }
    throw error;
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    const node = loadAgentNodeRow(db, agentId);
    if (!node || node.state !== "running") {
      return;
    }

    const resultBody = JSON.stringify({
      projectId,
      agentId,
      objective: taskObjective,
      summary: `Resultado local da tarefa "${node.name}" — aguardando aceite ou rejeição.`,
      reviewStatus: "pending",
    });
    const resultCas = db.putCasBlob(Buffer.from(resultBody, "utf8"));
    updateAgentNodeState(db, agentId, "complete", resultCas.contentRef);
    persistHarnessEventWithPayload(db, runId, AGENT_COMPLETED_EVENT, {
      projectId,
      agentId,
      name: node.name,
      resultRef: resultCas.contentRef,
      reviewStatus: "pending",
    });
  } finally {
    db.close();
    unregisterSubagentRun(context, runId, agentId);
  }
}

async function finalizeCoordinatorWhenTasksReady(
  context: DaemonRpcContext,
  runId: string,
  projectId: string,
  taskAgentIds: readonly string[],
  objective: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const db = openWorkspaceDatabase({
      dataRoot: context.dataRoot,
      workspaceId: context.binding.workspaceId,
    });
    try {
      const children = taskAgentIds.map((id) => loadAgentNodeRow(db, id));
      if (children.every((child) => child?.state === "complete" && child.result_ref)) {
        const coordinator = loadAgentNodeRow(db, projectId);
        if (!coordinator || coordinator.state !== "running") {
          return;
        }
        const resultBody = JSON.stringify({
          projectId,
          objective,
          taskAgentIds,
          summary: "Coordenador local dividiu o objetivo; resultados prontos para aceite/rejeição.",
        });
        const resultCas = db.putCasBlob(Buffer.from(resultBody, "utf8"));
        updateAgentNodeState(db, projectId, "complete", resultCas.contentRef);
        persistHarnessEventWithPayload(db, runId, AGENT_COMPLETED_EVENT, {
          projectId,
          agentId: projectId,
          name: coordinator.name,
          resultRef: resultCas.contentRef,
          role: "coordinator",
        });
        return;
      }
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * PRJ-01: abre coordenador local que divide o objetivo em tarefas de agentes na mesma máquina.
 */
export function createLocalProjectFromObjective(
  context: DaemonRpcContext,
  runId: string,
  objective: string,
): RpcResultMap[typeof RPC_METHOD.PROJECT_CREATE] {
  const trimmed = objective.trim();
  if (trimmed.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "objective inválido para project.create.",
    );
  }

  const tasks = divideObjectiveIntoAgentTasks(trimmed);
  if (tasks.length < 2) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Não foi possível dividir o objetivo em tarefas de agentes.",
    );
  }

  const db = openWorkspaceDatabase({
    dataRoot: context.dataRoot,
    workspaceId: context.binding.workspaceId,
  });
  try {
    assertProjectCreatePreconditions(context, runId, db);

    const projectId = randomUUID();
    const coordinatorName = coordinatorDisplayName(trimmed);

    db.insertAgentNode({
      id: projectId,
      runId,
      parentId: null,
      name: coordinatorName,
      state: "running",
      resultRef: null,
    });

    const taskAgentIds: string[] = [];
    for (const task of tasks) {
      const agentId = randomUUID();
      const name = taskDisplayName(task);
      db.insertAgentNode({
        id: agentId,
        runId,
        parentId: projectId,
        name,
        state: "running",
        resultRef: null,
      });
      persistHarnessEventWithPayload(db, runId, AGENT_SPAWNED_EVENT, {
        projectId,
        agentId,
        name,
        objective: task,
        role: "project-task",
      });
      taskAgentIds.push(agentId);
    }

    persistHarnessEventWithPayload(db, runId, PROJECT_CREATED_EVENT, {
      projectId,
      objective: trimmed,
      taskAgentIds,
      coordinatorName,
    });

    for (let index = 0; index < taskAgentIds.length; index += 1) {
      const agentId = taskAgentIds[index];
      const taskObjective = tasks[index];
      if (!agentId || !taskObjective) {
        continue;
      }
      const abortController = registerSubagentRun(context, runId, agentId);
      void completeProjectTaskAgent(
        context,
        runId,
        projectId,
        agentId,
        taskObjective,
        abortController.signal,
      ).catch(() => {
        unregisterSubagentRun(context, runId, agentId);
      });
    }

    void finalizeCoordinatorWhenTasksReady(
      context,
      runId,
      projectId,
      taskAgentIds,
      trimmed,
    ).catch(() => {
      /* best-effort: resultados das tarefas já são observáveis */
    });

    return { projectId };
  } finally {
    db.close();
  }
}

export function handleProjectCreate(
  context: DaemonRpcContext,
  runId: string,
  params: RpcParamsMap[typeof RPC_METHOD.PROJECT_CREATE],
): RpcResultMap[typeof RPC_METHOD.PROJECT_CREATE] {
  return createLocalProjectFromObjective(context, runId, params.objective);
}
