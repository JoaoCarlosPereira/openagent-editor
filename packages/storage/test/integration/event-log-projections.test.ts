import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { openWorkspaceDatabase } from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-proj-rebuild-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function seedWorkspaceSessionRun(
  database: DatabaseSync,
  workspaceId: string,
  sessionId: string,
  runId: string,
  mode = "ask",
): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
  database
    .prepare(
      `INSERT INTO session(id, workspace_id, mode, branch_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, workspaceId, mode, "main", "2026-10-28T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO run(id, session_id, state, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(runId, sessionId, "running", "2026-10-28T00:01:00.000Z");
}

function putJsonPayload(
  db: ReturnType<typeof openWorkspaceDatabase>,
  value: unknown,
): string {
  const put = db.putCasBlob(Buffer.from(JSON.stringify(value), "utf8"));
  return put.contentRef;
}

test("[SES-01] projeções reconstruíveis a partir do event log reabrem modo, mensagens, ferramentas e anexos", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-rebuild";
    const sessionId = "sess-rebuild";
    const runId = "run-rebuild";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(first.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId, "ask");
    database.close();

    const messageContentPut = first.putCasBlob(
      Buffer.from(JSON.stringify({ role: "user", text: "retomar" }), "utf8"),
    );
    const toolResultPut = first.putCasBlob(Buffer.from('{"stdout":"tool-ok"}', "utf8"));
    const attachmentPut = first.putCasBlob(Buffer.from("anexo persistido", "utf8"));

    const modePayloadRef = putJsonPayload(first, { sessionId, mode: "agent" });
    const messagesPayloadRef = putJsonPayload(first, {
      sessionId,
      messages: [
        {
          id: "msg-rebuild-1",
          role: "user",
          status: "complete",
          contentRef: messageContentPut.contentRef,
          tokenCount: 7,
        },
      ],
    });
    const toolPayloadRef = putJsonPayload(first, {
      runId,
      invocation: {
        id: "tool-rebuild-1",
        tool: "read_file",
        target: "/projeto/x.ts",
        capability: "file.read",
        state: "complete",
        resultRef: toolResultPut.contentRef,
      },
    });
    const attachmentPayloadRef = putJsonPayload(first, {
      sessionId,
      attachments: [{ id: "att-1", kind: "file", contentRef: attachmentPut.contentRef }],
    });

    first.appendHarnessEvent({
      runId,
      type: "session.mode",
      payloadRef: modePayloadRef,
      timestamp: 1_731_000_000_000,
    });
    first.appendHarnessEvent({
      runId,
      type: "message.snapshot",
      payloadRef: messagesPayloadRef,
      timestamp: 1_731_000_001_000,
    });
    first.appendHarnessEvent({
      runId,
      type: "tool.result",
      payloadRef: toolPayloadRef,
      timestamp: 1_731_000_002_000,
    });
    first.appendHarnessEvent({
      runId,
      type: "attachment.retained",
      payloadRef: attachmentPayloadRef,
      timestamp: 1_731_000_003_000,
    });

    const rebuilt = first.rebuildProjectionsFromEventLog(sessionId);
    first.close();

    assert.equal(rebuilt.appliedEventCount, 4);
    assert.equal(rebuilt.mode, "agent");

    const second = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sessionMode = new DatabaseSync(second.databasePath)
      .prepare("SELECT mode FROM session WHERE id = ?")
      .get(sessionId) as { mode: string };
    new DatabaseSync(second.databasePath).close();

    const messages = second.listMessages(sessionId);
    const tools = second.listToolInvocations(runId);
    const resumes = second.listSessionResumes();
    second.close();

    assert.equal(sessionMode.mode, "agent");
    assert.equal(messages.length, 1);
    const message = messages[0];
    assert.ok(message);
    assert.equal(message.tokenCount, 7);
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.ok(tool);
    assert.equal(tool.tool, "read_file");
    assert.ok(tool.resultRef);

    assert.equal(resumes.length, 1);
    const resume = resumes[0];
    assert.ok(resume);
    assert.equal(resume.mode, "agent");
    const attachments = JSON.parse(resume.attachmentsJson) as {
      id: string;
      contentRef: string;
    }[];
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.id, "att-1");

    const third = openWorkspaceDatabase({ dataRoot, workspaceId });
    const afterRestart = third.rebuildProjectionsFromEventLog(sessionId);
    const messagesAfter = third.listMessages(sessionId);
    third.close();

    assert.equal(afterRestart.mode, "agent");
    assert.equal(messagesAfter.length, 1);
    assert.equal(messagesAfter[0]?.id, "msg-rebuild-1");
  });
});

test("[SES-01] reconstrução inválida retorna INVALID_STATE sem alterar projeções existentes", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-rebuild-invalid";
    const sessionId = "sess-invalid";
    const runId = "run-invalid";

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(db.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId);
    database.close();

    const goodMessageRef = putJsonPayload(db, {
      sessionId,
      messages: [
        {
          id: "msg-good",
          role: "user",
          status: "complete",
          contentRef: db.putCasBlob(Buffer.from("{}", "utf8")).contentRef,
          tokenCount: 1,
        },
      ],
    });

    db.appendHarnessEvent({
      runId,
      type: "message.snapshot",
      payloadRef: goodMessageRef,
      timestamp: 1,
    });
    db.rebuildProjectionsFromEventLog(sessionId);
    assert.equal(db.listMessages(sessionId).length, 1);

    const badPayloadRef = putJsonPayload(db, { sessionId, messages: "not-an-array" });
    db.appendHarnessEvent({
      runId,
      type: "message.snapshot",
      payloadRef: badPayloadRef,
      timestamp: 2,
    });

    assert.throws(
      () => db.rebuildProjectionsFromEventLog(sessionId),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const messages = db.listMessages(sessionId);
    db.close();
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "msg-good");
  });
});
