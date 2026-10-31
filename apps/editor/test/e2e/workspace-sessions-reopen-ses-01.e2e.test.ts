import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, type SessionListItem } from "@openagent/protocol";

import {
  WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE,
  WorkspaceSessionReopenController,
  type WorkspaceSessionListPort,
} from "../../src/agents/session-reopen.js";

function sampleSessions(): SessionListItem[] {
  return [
    {
      sessionId: "sess-resume-1",
      mode: "plan",
      messagesJson: JSON.stringify([
        { role: "user", text: "retomar após reinício" },
        { role: "assistant", content: "Sessão restaurada." },
      ]),
      toolsJson: JSON.stringify([{ name: "grep", state: "done" }]),
      attachmentsJson: JSON.stringify([
        { id: "att-ok", kind: "file", contentRef: "sha256:alive" },
        { id: "att-gone", kind: "file", contentRef: "sha256:missing" },
        { id: "att-meta", kind: "selection" },
      ]),
    },
  ];
}

describe("SES-01 e2e — sessões do workspace reabertas após reinício do editor", () => {
  it("reabre modo, mensagens, ferramentas e anexos que ainda existem", () => {
    const controller = new WorkspaceSessionReopenController();
    const existing = new Set(["sha256:alive"]);
    const result = controller.reopen({
      workspaceId: "ws-editor-147",
      sessions: sampleSessions(),
      attachmentExists: (contentRef) => existing.has(contentRef),
    });

    assert.equal(result.workspaceId, "ws-editor-147");
    assert.equal(result.sessions.length, 1);
    const session = result.sessions[0];
    assert.ok(session);
    assert.equal(session.mode, "plan");
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[0]?.content, "retomar após reinício");
    assert.equal(session.messages[1]?.content, "Sessão restaurada.");
    assert.deepEqual(session.tools, [{ name: "grep", state: "done" }]);
    assert.equal(session.attachments.length, 2);
    assert.ok(session.attachments.some((row) => row.id === "att-ok"));
    assert.ok(session.attachments.some((row) => row.id === "att-meta"));
    assert.ok(!session.attachments.some((row) => row.id === "att-gone"));
    assert.equal(session.panel.snapshot.accessible.historyCount, 2);
    assert.match(result.view.html, /data-testid="workspace-sessions-reopen"/);
    assert.match(result.view.html, /data-session-mode="plan"/);
    assert.match(result.view.html, /retomar após reinício/);
    assert.match(result.view.html, /data-tool-name="grep"/);
    assert.match(result.view.html, /data-attachment-id="att-ok"/);
    assert.doesNotMatch(result.view.html, /data-attachment-id="att-gone"/);
    assert.equal(result.view.accessible.sessionCount, 1);
  });

  it("reabre a partir de session.list do daemon após reinício simulado", async () => {
    const persisted = sampleSessions();
    const port: WorkspaceSessionListPort = {
      async listSessions(input) {
        assert.equal(input.workspaceId, "ws-daemon-147");
        return { sessions: persisted };
      },
    };
    const controller = new WorkspaceSessionReopenController();
    const result = await controller.reopenFromDaemon(port, {
      workspaceId: "ws-daemon-147",
      attachmentExists: (contentRef) => contentRef === "sha256:alive",
    });

    assert.equal(result.sessions[0]?.sessionId, "sess-resume-1");
    assert.equal(result.sessions[0]?.attachments.length, 2);
    assert.equal(controller.snapshot.accessible.workspaceId, "ws-daemon-147");
  });

  it("caminho de erro: workspaceId inválido retorna INVALID_STATE sem efeito colateral", () => {
    const controller = new WorkspaceSessionReopenController();
    controller.reopen({
      workspaceId: "ws-keep",
      sessions: sampleSessions(),
      attachmentExists: () => true,
    });
    const before = controller.snapshot;

    assert.throws(
      () =>
        controller.reopen({
          workspaceId: "   ",
          sessions: sampleSessions(),
        }),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === WORKSPACE_SESSION_REOPEN_INVALID_MESSAGE,
    );
    assert.equal(controller.snapshot.accessible.workspaceId, before.accessible.workspaceId);
    assert.equal(controller.snapshot.accessible.sessionCount, before.accessible.sessionCount);
  });

  it("caminho de erro: sessão malformada retorna INVALID_STATE sem mutar estado anterior", () => {
    const controller = new WorkspaceSessionReopenController();
    controller.reopen({
      workspaceId: "ws-keep-2",
      sessions: sampleSessions(),
      attachmentExists: () => true,
    });

    assert.throws(
      () =>
        controller.reopen({
          workspaceId: "ws-keep-2",
          sessions: [
            {
              sessionId: "sess-bad",
              mode: "plan",
              messagesJson: "{not-json",
              toolsJson: "[]",
              attachmentsJson: "[]",
            },
          ],
        }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );
    assert.equal(controller.currentSessions[0]?.sessionId, "sess-resume-1");
    assert.equal(controller.snapshot.accessible.sessionCount, 1);
  });
});
