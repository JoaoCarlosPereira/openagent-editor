import type { AgentMode } from "@openagent/protocol";

import type { AgentHistoryMessage } from "../agent/agent-history.js";

export interface SessionReopenAttachment {
  id: string;
  kind: string;
  contentRef?: string;
}

export interface SessionReopenTool {
  name: string;
  state?: string;
}

export interface SessionReopenViewSession {
  sessionId: string;
  mode: AgentMode;
  messages: readonly AgentHistoryMessage[];
  tools: readonly SessionReopenTool[];
  attachments: readonly SessionReopenAttachment[];
}

export interface WorkspaceSessionReopenViewInput {
  workspaceId: string;
  sessions: readonly SessionReopenViewSession[];
}

export interface WorkspaceSessionReopenViewSnapshot {
  html: string;
  accessible: {
    workspaceId: string;
    sessionCount: number;
    sessionIds: readonly string[];
    modes: readonly AgentMode[];
    focusOrder: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMessage(message: AgentHistoryMessage): string {
  return [
    `<li data-testid="workspace-session-message" data-role="${escapeHtml(message.role)}" data-message-id="${escapeHtml(message.id)}">`,
    `<span data-testid="workspace-session-message-role">${escapeHtml(message.role)}</span>`,
    `<p data-testid="workspace-session-message-body">${escapeHtml(message.content)}</p>`,
    `</li>`,
  ].join("");
}

function renderTool(tool: SessionReopenTool): string {
  const stateAttr =
    tool.state !== undefined ? ` data-tool-state="${escapeHtml(tool.state)}"` : "";
  return `<li data-testid="workspace-session-tool" data-tool-name="${escapeHtml(tool.name)}"${stateAttr}>${escapeHtml(tool.name)}</li>`;
}

function renderAttachment(attachment: SessionReopenAttachment): string {
  const refAttr =
    attachment.contentRef !== undefined
      ? ` data-content-ref="${escapeHtml(attachment.contentRef)}"`
      : "";
  return [
    `<li data-testid="workspace-session-attachment" data-attachment-id="${escapeHtml(attachment.id)}" data-attachment-kind="${escapeHtml(attachment.kind)}"${refAttr}>`,
    escapeHtml(attachment.id),
    `</li>`,
  ].join("");
}

function renderSession(session: SessionReopenViewSession): string {
  const messages =
    session.messages.length > 0
      ? session.messages.map(renderMessage).join("")
      : `<li data-testid="workspace-session-messages-empty">Sem mensagens.</li>`;
  const tools =
    session.tools.length > 0
      ? session.tools.map(renderTool).join("")
      : `<li data-testid="workspace-session-tools-empty">Sem ferramentas.</li>`;
  const attachments =
    session.attachments.length > 0
      ? session.attachments.map(renderAttachment).join("")
      : `<li data-testid="workspace-session-attachments-empty">Sem anexos.</li>`;

  return [
    `<article role="article" data-testid="workspace-session-card" data-session-id="${escapeHtml(session.sessionId)}" data-session-mode="${escapeHtml(session.mode)}" tabindex="0">`,
    `<h3 data-testid="workspace-session-title">Sessão ${escapeHtml(session.sessionId)}</h3>`,
    `<p data-testid="workspace-session-mode">Modo: ${escapeHtml(session.mode)}</p>`,
    `<ol data-testid="workspace-session-messages" aria-label="Mensagens reabertas">${messages}</ol>`,
    `<ul data-testid="workspace-session-tools" aria-label="Ferramentas reabertas">${tools}</ul>`,
    `<ul data-testid="workspace-session-attachments" aria-label="Anexos existentes">${attachments}</ul>`,
    `</article>`,
  ].join("");
}

/** SES-01 (147): lista de sessões reabertas após reinício do editor. */
export function buildWorkspaceSessionReopenView(
  input: WorkspaceSessionReopenViewInput,
): WorkspaceSessionReopenViewSnapshot {
  const focusOrder = ["workspace-sessions-reopen", "workspace-session-card"] as const;
  const cards =
    input.sessions.length > 0
      ? input.sessions.map(renderSession).join("")
      : `<p data-testid="workspace-sessions-empty">Nenhuma sessão persistida neste workspace.</p>`;

  const html = [
    `<section role="region" aria-labelledby="workspace-sessions-reopen-title" data-testid="workspace-sessions-reopen" data-workspace-id="${escapeHtml(input.workspaceId)}" tabindex="0">`,
    `<h2 id="workspace-sessions-reopen-title">Sessões do workspace</h2>`,
    cards,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      workspaceId: input.workspaceId,
      sessionCount: input.sessions.length,
      sessionIds: input.sessions.map((row) => row.sessionId),
      modes: input.sessions.map((row) => row.mode),
      focusOrder,
    },
  };
}
