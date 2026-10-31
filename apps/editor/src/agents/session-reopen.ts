import {
  ProtocolError,
  type AgentMode,
  type SessionListItem,
} from "@openagent/protocol";

import {
  createAgentHistoryMessage,
  type AgentHistoryMessage,
  type AgentHistoryRole,
} from "../agent/agent-history.js";
import { AgentPanelController } from "../agent/agent-panel.js";
import {
  buildWorkspaceSessionReopenView,
  type SessionReopenAttachment,
  type SessionReopenTool,
  type SessionReopenViewSession,
  type WorkspaceSessionReopenViewSnapshot,
} from "./session-reopen-view.js";

export type {
  SessionReopenAttachment,
  SessionReopenTool,
  SessionReopenViewSession,
  WorkspaceSessionReopenViewSnapshot,
} from "./session-reopen-view.js";
export { buildWorkspaceSessionReopenView } from "./session-reopen-view.js";

export const WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE =
  "Workspace ou sessões inválidas para reabrir após reinício do editor.";

const AGENT_MODES: readonly AgentMode[] = ["ask", "plan", "agent", "debug"];
const HISTORY_ROLES: readonly AgentHistoryRole[] = ["user", "assistant", "system"];

export interface WorkspaceSessionListPort {
  listSessions(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<{ sessions: readonly SessionListItem[] }>;
}

export interface ReopenedWorkspaceSession {
  sessionId: string;
  mode: AgentMode;
  messages: readonly AgentHistoryMessage[];
  tools: readonly SessionReopenTool[];
  attachments: readonly SessionReopenAttachment[];
  panel: AgentPanelController;
}

export interface WorkspaceSessionReopenResult {
  workspaceId: string;
  sessions: readonly ReopenedWorkspaceSession[];
  view: WorkspaceSessionReopenViewSnapshot;
}

export interface WorkspaceSessionReopenInput {
  workspaceId: unknown;
  sessions: unknown;
  /** Quando informado, remove anexos cujo contentRef não existe mais (SES-01). */
  attachmentExists?: (contentRef: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertWorkspaceId(workspaceId: unknown): string {
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `workspaceId=${String(workspaceId)}`,
    ]);
  }
  return workspaceId.trim();
}

function assertAgentMode(value: unknown, sessionId: string): AgentMode {
  if (typeof value !== "string" || !AGENT_MODES.includes(value as AgentMode)) {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `sessionId=${sessionId}`,
      `mode=${String(value)}`,
    ]);
  }
  return value as AgentMode;
}

function parseJsonArray(raw: unknown, label: string, sessionId: string): unknown[] {
  if (typeof raw !== "string") {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `sessionId=${sessionId}`,
      `${label}=non-string`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `sessionId=${sessionId}`,
      `${label}=invalid-json`,
    ]);
  }
  if (!Array.isArray(parsed)) {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `sessionId=${sessionId}`,
      `${label}=not-array`,
    ]);
  }
  return parsed;
}

function parseMessages(raw: unknown, sessionId: string): AgentHistoryMessage[] {
  const items = parseJsonArray(raw, "messagesJson", sessionId);
  const messages: AgentHistoryMessage[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      continue;
    }
    const role = item["role"];
    if (typeof role !== "string" || !HISTORY_ROLES.includes(role as AgentHistoryRole)) {
      continue;
    }
    const text =
      typeof item["text"] === "string"
        ? item["text"]
        : typeof item["content"] === "string"
          ? item["content"]
          : "";
    messages.push(
      createAgentHistoryMessage(role as AgentHistoryRole, text, `${sessionId}-msg-${index}`),
    );
  }
  return messages;
}

function parseTools(raw: unknown, sessionId: string): SessionReopenTool[] {
  const items = parseJsonArray(raw, "toolsJson", sessionId);
  const tools: SessionReopenTool[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["name"] !== "string" || item["name"].trim() === "") {
      continue;
    }
    const tool: SessionReopenTool = { name: item["name"] };
    if (typeof item["state"] === "string") {
      tool.state = item["state"];
    }
    tools.push(tool);
  }
  return tools;
}

function parseAttachments(
  raw: unknown,
  sessionId: string,
  attachmentExists?: (contentRef: string) => boolean,
): SessionReopenAttachment[] {
  const items = parseJsonArray(raw, "attachmentsJson", sessionId);
  const attachments: SessionReopenAttachment[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["id"] !== "string" || item["id"].trim() === "") {
      continue;
    }
    if (typeof item["kind"] !== "string" || item["kind"].trim() === "") {
      continue;
    }
    const contentRef =
      typeof item["contentRef"] === "string" && item["contentRef"].trim() !== ""
        ? item["contentRef"]
        : undefined;
    if (contentRef !== undefined && attachmentExists && !attachmentExists(contentRef)) {
      continue;
    }
    const attachment: SessionReopenAttachment = {
      id: item["id"],
      kind: item["kind"],
    };
    if (contentRef !== undefined) {
      attachment.contentRef = contentRef;
    }
    attachments.push(attachment);
  }
  return attachments;
}

function parseSessionListItem(
  value: unknown,
  attachmentExists?: (contentRef: string) => boolean,
): SessionReopenViewSession {
  if (!isRecord(value) || typeof value["sessionId"] !== "string" || value["sessionId"].trim() === "") {
    throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
      `sessionId=${String(isRecord(value) ? value["sessionId"] : value)}`,
    ]);
  }
  const sessionId = value["sessionId"].trim();
  const mode = assertAgentMode(value["mode"], sessionId);
  return {
    sessionId,
    mode,
    messages: parseMessages(value["messagesJson"], sessionId),
    tools: parseTools(value["toolsJson"], sessionId),
    attachments: parseAttachments(value["attachmentsJson"], sessionId, attachmentExists),
  };
}

/**
 * SES-01 (147): reabre sessões do workspace após reinício do editor
 * (modo, mensagens, ferramentas e anexos que ainda existam).
 */
export class WorkspaceSessionReopenController {
  private workspaceId = "";
  private sessions: ReopenedWorkspaceSession[] = [];
  private view: WorkspaceSessionReopenViewSnapshot = buildWorkspaceSessionReopenView({
    workspaceId: "",
    sessions: [],
  });

  get snapshot(): WorkspaceSessionReopenViewSnapshot {
    return this.view;
  }

  get currentSessions(): readonly ReopenedWorkspaceSession[] {
    return this.sessions;
  }

  reopen(input: WorkspaceSessionReopenInput): WorkspaceSessionReopenResult {
    const workspaceId = assertWorkspaceId(input.workspaceId);
    if (!Array.isArray(input.sessions)) {
      throw new ProtocolError("INVALID_STATE", WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE, [
        "sessions=not-array",
      ]);
    }

    const mapped: ReopenedWorkspaceSession[] = [];
    for (const raw of input.sessions) {
      const parsed = parseSessionListItem(raw, input.attachmentExists);
      const panel = new AgentPanelController();
      panel.open({
        sessionId: parsed.sessionId,
        initialHistory: parsed.messages,
      });
      mapped.push({
        sessionId: parsed.sessionId,
        mode: parsed.mode,
        messages: parsed.messages,
        tools: parsed.tools,
        attachments: parsed.attachments,
        panel,
      });
    }

    this.workspaceId = workspaceId;
    this.sessions = mapped;
    this.view = buildWorkspaceSessionReopenView({
      workspaceId,
      sessions: mapped.map((row) => ({
        sessionId: row.sessionId,
        mode: row.mode,
        messages: row.messages,
        tools: row.tools,
        attachments: row.attachments,
      })),
    });

    return {
      workspaceId: this.workspaceId,
      sessions: this.sessions,
      view: this.view,
    };
  }

  /** Conecta ao daemon via porta injetável e reabre o que `session.list` devolver. */
  async reopenFromDaemon(
    port: WorkspaceSessionListPort,
    input: {
      workspaceId: unknown;
      limit?: number;
      attachmentExists?: (contentRef: string) => boolean;
    },
  ): Promise<WorkspaceSessionReopenResult> {
    const workspaceId = assertWorkspaceId(input.workspaceId);
    const listed = await port.listSessions({
      workspaceId,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    return this.reopen({
      workspaceId,
      sessions: listed.sessions,
      ...(input.attachmentExists ? { attachmentExists: input.attachmentExists } : {}),
    });
  }
}
