import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  HARNESS_EVENT_SCHEMA_VERSION,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-crash-recovery-"));
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
    .run(sessionId, workspaceId, "ask", "main", "2026-10-28T00:00:00.000Z");
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

function appendCommittedSessionEvents(
  db: ReturnType<typeof openWorkspaceDatabase>,
  sessionId: string,
  runId: string,
): void {
  const messageContentPut = db.putCasBlob(
    Buffer.from(JSON.stringify({ role: "user", text: "retomar após crash" }), "utf8"),
  );
  const toolResultPut = db.putCasBlob(Buffer.from('{"stdout":"tool-ok"}', "utf8"));
  const attachmentPut = db.putCasBlob(Buffer.from("anexo persistido", "utf8"));

  const modePayloadRef = putJsonPayload(db, { sessionId, mode: "agent" });
  const messagesPayloadRef = putJsonPayload(db, {
    sessionId,
    messages: [
      {
        id: "msg-crash-1",
        role: "user",
        status: "complete",
        contentRef: messageContentPut.contentRef,
        tokenCount: 9,
      },
    ],
  });
  const toolPayloadRef = putJsonPayload(db, {
    runId,
    invocation: {
      id: "tool-crash-1",
      tool: "read_file",
      target: "/projeto/x.ts",
      capability: "file.read",
      state: "complete",
      resultRef: toolResultPut.contentRef,
    },
  });
  const attachmentPayloadRef = putJsonPayload(db, {
    sessionId,
    attachments: [{ id: "att-crash-1", kind: "file", contentRef: attachmentPut.contentRef }],
  });

  db.appendHarnessEvent({
    runId,
    type: "session.mode",
    payloadRef: modePayloadRef,
    timestamp: 1_731_000_000_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "message.snapshot",
    payloadRef: messagesPayloadRef,
    timestamp: 1_731_000_001_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "tool.result",
    payloadRef: toolPayloadRef,
    timestamp: 1_731_000_002_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "attachment.retained",
    payloadRef: attachmentPayloadRef,
    timestamp: 1_731_000_003_000,
  });
}

function simulateCrashDuringUncommittedAppend(databasePath: string, runId: string): void {
  const raw = new DatabaseSync(databasePath);
  raw.exec("BEGIN IMMEDIATE");
  raw
    .prepare(
      `INSERT INTO harness_event(
        sequence, run_id, type, schema_version, payload_ref, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      99,
      runId,
      "message.delta",
      HARNESS_EVENT_SCHEMA_VERSION,
      "cas:uncommitted",
      1_731_000_099_000,
    );
  raw.close();
}

test("[SES-01] recovery após crash durante escrita preserva log commitado e reabre sessão", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-crash-recovery";
    const sessionId = "sess-crash";
    const runId = "run-crash";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = first.databasePath;
    const seedDb = new DatabaseSync(databasePath);
    seedWorkspaceSessionRun(seedDb, workspaceId, sessionId, runId);
    seedDb.close();

    appendCommittedSessionEvents(first, sessionId, runId);
    first.close();

    simulateCrashDuringUncommittedAppend(databasePath, runId);

    const reopened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const events = reopened.listHarnessEvents(runId);
    const messages = reopened.listMessages(sessionId);
    const tools = reopened.listToolInvocations(runId);
    const resumes = reopened.listSessionResumes();
    reopened.close();

    assert.equal(events.length, 4);
    assert.equal(events[0]?.sequence, 1);
    assert.equal(events[3]?.sequence, 4);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "msg-crash-1");
    assert.equal(messages[0]?.tokenCount, 9);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.tool, "read_file");
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0]?.mode, "agent");
    const attachments = JSON.parse(resumes[0]?.attachmentsJson ?? "[]") as { id: string }[];
    assert.equal(attachments[0]?.id, "att-crash-1");
  });
});

test("[SES-01] recovery inválida retorna INVALID_STATE sem apagar log commitado", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-crash-invalid";
    const sessionId = "sess-crash-invalid";
    const runId = "run-crash-invalid";

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const seedDb = new DatabaseSync(db.databasePath);
    seedWorkspaceSessionRun(seedDb, workspaceId, sessionId, runId);
    seedDb.close();

    const goodMessageRef = putJsonPayload(db, {
      sessionId,
      messages: [
        {
          id: "msg-good-crash",
          role: "user",
          status: "complete",
          contentRef: db.putCasBlob(Buffer.from("{}", "utf8")).contentRef,
          tokenCount: 2,
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
      () => db.recoverFromCommittedEventLog(),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const events = db.listHarnessEvents(runId);
    const messages = db.listMessages(sessionId);
    db.close();

    assert.equal(events.length, 2);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "msg-good-crash");
  });
});
