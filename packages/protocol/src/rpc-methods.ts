import type { HarnessEvent } from "./harness-event.js";
import type { UserInput } from "./user-input.js";

/** Versão do catálogo de métodos RPC locais (ADR-003). */
export const RPC_PROTOCOL_VERSION = 1 as const;

/**
 * Métodos RPC versionados conforme TechSpec — tabela "Endpoints de API".
 * Nomes estáveis para editor, CLI e harness-daemon.
 */
export const RPC_METHOD = {
  SESSION_CREATE: "session.create",
  SESSION_LIST: "session.list",
  SESSION_SEARCH: "session.search",
  SESSION_EXPORT: "session.export",
  SESSION_DELETE: "session.delete",
  SESSION_FORK: "session.fork",
  RUN_START: "run.start",
  RUN_CANCEL: "run.cancel",
  RUN_RESUME: "run.resume",
  RUN_QUEUE_ADD: "run.queue.add",
  RUN_QUEUE_REMOVE: "run.queue.remove",
  PERMISSION_DECIDE: "permission.decide",
  TOOL_INVOKE: "tool.invoke",
  CHECKPOINT_CREATE: "checkpoint.create",
  CHECKPOINT_RESTORE: "checkpoint.restore",
  AGENT_SPAWN: "agent.spawn",
  AGENT_CANCEL: "agent.cancel",
  PROJECT_CREATE: "project.create",
  PROJECT_ACCEPT: "project.accept",
  PROJECT_REJECT: "project.reject",
  CONTEXT_ATTACH: "context.attach",
  CONTEXT_INDEX: "context.index",
  CONTEXT_SEARCH: "context.search",
  CONTEXT_CLEAR: "context.clear",
  EXTENSION_INSTALL: "extension.install",
  EXTENSION_ENABLE: "extension.enable",
  EXTENSION_DISABLE: "extension.disable",
} as const;

export type RpcMethod = (typeof RPC_METHOD)[keyof typeof RPC_METHOD];

export const ALL_RPC_METHODS: readonly RpcMethod[] = Object.values(RPC_METHOD);

export type AgentMode = "ask" | "plan" | "agent" | "debug";

export type PermissionDecision = "allow" | "deny";

/** Facetas de configuração compartilhadas por workspace (CLI-01). */
export type WorkspaceBindingFacet =
  | "provider"
  | "mode"
  | "rules"
  | "mcp"
  | "sessions";

export interface RpcMethodSpec {
  method: RpcMethod;
  capability: string;
  workspaceBindings: readonly WorkspaceBindingFacet[];
}

export interface SessionCreateParams {
  mode?: AgentMode;
}

export interface SessionListParams {
  limit?: number;
  cursor?: string;
}

export interface SessionSearchParams {
  query: string;
  limit?: number;
}

export interface SessionExportParams {
  format?: "text" | "json";
}

export interface SessionForkParams {
  branchId?: string;
}

export type SessionListItem = {
  sessionId: string;
  mode: AgentMode;
  messagesJson: string;
  toolsJson: string;
  attachmentsJson: string;
};

export interface RunStartParams {
  mode?: AgentMode;
  input: UserInput;
}

export interface RunCancelParams {
  agentId?: string;
}

export interface RunResumeParams {
  checkpointId?: string;
}

export interface RunQueueAddParams {
  input: UserInput;
  ordinal?: number;
}

export interface RunQueueRemoveParams {
  queueItemId: string;
}

export interface PermissionDecideParams {
  permissionRequestId: string;
  decision: PermissionDecision;
  scope?: string;
}

export interface ToolInvokeParams {
  tool: string;
  target: string;
  arguments: Record<string, unknown>;
  expectedHash?: string;
}

export interface CheckpointCreateParams {
  label?: string;
}

export interface CheckpointRestoreParams {
  checkpointId: string;
}

export interface AgentSpawnParams {
  objective: string;
}

export interface AgentCancelParams {
  agentId: string;
}

export interface ProjectCreateParams {
  objective: string;
}

export interface ProjectAcceptParams {
  nodeId: string;
}

export interface ProjectRejectParams {
  nodeId: string;
}

export interface ContextAttachParams {
  refs: string[];
}

export interface ContextIndexParams {
  paths?: string[];
}

export interface ContextSearchParams {
  query: string;
  limit?: number;
}

export interface ContextClearParams {
  scope?: "session" | "workspace";
}

export interface ExtensionInstallParams {
  packageRef: string;
}

export interface ExtensionEnableParams {
  extensionId: string;
}

export interface ExtensionDisableParams {
  extensionId: string;
}

export interface RpcParamsMap {
  [RPC_METHOD.SESSION_CREATE]: SessionCreateParams;
  [RPC_METHOD.SESSION_LIST]: SessionListParams;
  [RPC_METHOD.SESSION_SEARCH]: SessionSearchParams;
  [RPC_METHOD.SESSION_EXPORT]: SessionExportParams;
  [RPC_METHOD.SESSION_DELETE]: Record<string, never>;
  [RPC_METHOD.SESSION_FORK]: SessionForkParams;
  [RPC_METHOD.RUN_START]: RunStartParams;
  [RPC_METHOD.RUN_CANCEL]: RunCancelParams;
  [RPC_METHOD.RUN_RESUME]: RunResumeParams;
  [RPC_METHOD.RUN_QUEUE_ADD]: RunQueueAddParams;
  [RPC_METHOD.RUN_QUEUE_REMOVE]: RunQueueRemoveParams;
  [RPC_METHOD.PERMISSION_DECIDE]: PermissionDecideParams;
  [RPC_METHOD.TOOL_INVOKE]: ToolInvokeParams;
  [RPC_METHOD.CHECKPOINT_CREATE]: CheckpointCreateParams;
  [RPC_METHOD.CHECKPOINT_RESTORE]: CheckpointRestoreParams;
  [RPC_METHOD.AGENT_SPAWN]: AgentSpawnParams;
  [RPC_METHOD.AGENT_CANCEL]: AgentCancelParams;
  [RPC_METHOD.PROJECT_CREATE]: ProjectCreateParams;
  [RPC_METHOD.PROJECT_ACCEPT]: ProjectAcceptParams;
  [RPC_METHOD.PROJECT_REJECT]: ProjectRejectParams;
  [RPC_METHOD.CONTEXT_ATTACH]: ContextAttachParams;
  [RPC_METHOD.CONTEXT_INDEX]: ContextIndexParams;
  [RPC_METHOD.CONTEXT_SEARCH]: ContextSearchParams;
  [RPC_METHOD.CONTEXT_CLEAR]: ContextClearParams;
  [RPC_METHOD.EXTENSION_INSTALL]: ExtensionInstallParams;
  [RPC_METHOD.EXTENSION_ENABLE]: ExtensionEnableParams;
  [RPC_METHOD.EXTENSION_DISABLE]: ExtensionDisableParams;
}

export interface RpcResultMap {
  [RPC_METHOD.SESSION_CREATE]: { sessionId: string; workspaceId: string; mode: AgentMode };
  [RPC_METHOD.SESSION_LIST]: { sessions: SessionListItem[] };
  [RPC_METHOD.SESSION_SEARCH]: { sessions: Array<{ sessionId: string; mode: AgentMode }> };
  [RPC_METHOD.SESSION_EXPORT]: { exportRef: string };
  [RPC_METHOD.SESSION_DELETE]: { deleted: true };
  [RPC_METHOD.SESSION_FORK]: { sessionId: string; parentSessionId: string };
  [RPC_METHOD.RUN_START]: HarnessEvent;
  [RPC_METHOD.RUN_CANCEL]: { cancelled: true };
  [RPC_METHOD.RUN_RESUME]: HarnessEvent;
  [RPC_METHOD.RUN_QUEUE_ADD]: { queueItemId: string; ordinal: number };
  [RPC_METHOD.RUN_QUEUE_REMOVE]: { removed: true };
  [RPC_METHOD.PERMISSION_DECIDE]: { persisted: boolean };
  [RPC_METHOD.TOOL_INVOKE]: { resultRef: string };
  [RPC_METHOD.CHECKPOINT_CREATE]: { checkpointId: string };
  [RPC_METHOD.CHECKPOINT_RESTORE]: { restored: true } | { conflict: true };
  [RPC_METHOD.AGENT_SPAWN]: { agentId: string };
  [RPC_METHOD.AGENT_CANCEL]: { cancelled: true };
  [RPC_METHOD.PROJECT_CREATE]: { projectId: string };
  [RPC_METHOD.PROJECT_ACCEPT]: { accepted: true };
  [RPC_METHOD.PROJECT_REJECT]: { rejected: true };
  [RPC_METHOD.CONTEXT_ATTACH]: { attached: string[] };
  [RPC_METHOD.CONTEXT_INDEX]: { indexed: number };
  [RPC_METHOD.CONTEXT_SEARCH]: { hits: Array<{ ref: string; score: number }> };
  [RPC_METHOD.CONTEXT_CLEAR]: { cleared: true };
  [RPC_METHOD.EXTENSION_INSTALL]: { extensionId: string };
  [RPC_METHOD.EXTENSION_ENABLE]: { enabled: true };
  [RPC_METHOD.EXTENSION_DISABLE]: { disabled: true };
}

const CLI_WORKSPACE_BINDINGS: readonly WorkspaceBindingFacet[] = [
  "provider",
  "mode",
  "rules",
  "mcp",
  "sessions",
];

export const RPC_METHOD_SPECS: Record<RpcMethod, RpcMethodSpec> = {
  [RPC_METHOD.SESSION_CREATE]: {
    method: RPC_METHOD.SESSION_CREATE,
    capability: "session.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.SESSION_LIST]: {
    method: RPC_METHOD.SESSION_LIST,
    capability: "session.read",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.SESSION_SEARCH]: {
    method: RPC_METHOD.SESSION_SEARCH,
    capability: "session.read",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.SESSION_EXPORT]: {
    method: RPC_METHOD.SESSION_EXPORT,
    capability: "session.read",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.SESSION_DELETE]: {
    method: RPC_METHOD.SESSION_DELETE,
    capability: "session.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.SESSION_FORK]: {
    method: RPC_METHOD.SESSION_FORK,
    capability: "session.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.RUN_START]: {
    method: RPC_METHOD.RUN_START,
    capability: "run.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.RUN_CANCEL]: {
    method: RPC_METHOD.RUN_CANCEL,
    capability: "run.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.RUN_RESUME]: {
    method: RPC_METHOD.RUN_RESUME,
    capability: "run.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.RUN_QUEUE_ADD]: {
    method: RPC_METHOD.RUN_QUEUE_ADD,
    capability: "run.queue",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.RUN_QUEUE_REMOVE]: {
    method: RPC_METHOD.RUN_QUEUE_REMOVE,
    capability: "run.queue",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.PERMISSION_DECIDE]: {
    method: RPC_METHOD.PERMISSION_DECIDE,
    capability: "permission.grant",
    workspaceBindings: ["rules", "mcp"],
  },
  [RPC_METHOD.TOOL_INVOKE]: {
    method: RPC_METHOD.TOOL_INVOKE,
    capability: "tool.invoke",
    workspaceBindings: ["rules", "mcp"],
  },
  [RPC_METHOD.CHECKPOINT_CREATE]: {
    method: RPC_METHOD.CHECKPOINT_CREATE,
    capability: "checkpoint.write",
    workspaceBindings: ["sessions"],
  },
  [RPC_METHOD.CHECKPOINT_RESTORE]: {
    method: RPC_METHOD.CHECKPOINT_RESTORE,
    capability: "checkpoint.write",
    workspaceBindings: ["sessions"],
  },
  [RPC_METHOD.AGENT_SPAWN]: {
    method: RPC_METHOD.AGENT_SPAWN,
    capability: "agent.spawn",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.AGENT_CANCEL]: {
    method: RPC_METHOD.AGENT_CANCEL,
    capability: "agent.spawn",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.PROJECT_CREATE]: {
    method: RPC_METHOD.PROJECT_CREATE,
    capability: "project.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.PROJECT_ACCEPT]: {
    method: RPC_METHOD.PROJECT_ACCEPT,
    capability: "project.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.PROJECT_REJECT]: {
    method: RPC_METHOD.PROJECT_REJECT,
    capability: "project.write",
    workspaceBindings: CLI_WORKSPACE_BINDINGS,
  },
  [RPC_METHOD.CONTEXT_ATTACH]: {
    method: RPC_METHOD.CONTEXT_ATTACH,
    capability: "context.write",
    workspaceBindings: ["provider", "rules", "mcp", "sessions"],
  },
  [RPC_METHOD.CONTEXT_INDEX]: {
    method: RPC_METHOD.CONTEXT_INDEX,
    capability: "context.write",
    workspaceBindings: ["rules", "mcp", "sessions"],
  },
  [RPC_METHOD.CONTEXT_SEARCH]: {
    method: RPC_METHOD.CONTEXT_SEARCH,
    capability: "context.read",
    workspaceBindings: ["rules", "mcp", "sessions"],
  },
  [RPC_METHOD.CONTEXT_CLEAR]: {
    method: RPC_METHOD.CONTEXT_CLEAR,
    capability: "context.write",
    workspaceBindings: ["sessions"],
  },
  [RPC_METHOD.EXTENSION_INSTALL]: {
    method: RPC_METHOD.EXTENSION_INSTALL,
    capability: "extension.install",
    workspaceBindings: ["mcp"],
  },
  [RPC_METHOD.EXTENSION_ENABLE]: {
    method: RPC_METHOD.EXTENSION_ENABLE,
    capability: "extension.manage",
    workspaceBindings: ["mcp"],
  },
  [RPC_METHOD.EXTENSION_DISABLE]: {
    method: RPC_METHOD.EXTENSION_DISABLE,
    capability: "extension.manage",
    workspaceBindings: ["mcp"],
  },
};

export function isRpcMethod(value: unknown): value is RpcMethod {
  return typeof value === "string" && (ALL_RPC_METHODS as string[]).includes(value);
}

export function getRpcMethodSpec(method: RpcMethod): RpcMethodSpec {
  return RPC_METHOD_SPECS[method];
}
