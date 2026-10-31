import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createWorkspaceStorageBackup,
  restoreWorkspaceStorageBackup,
} from "../../src/storage-backup.js";
import { openWorkspaceDatabase } from "../../src/index.js";

async function withTempDirs<T>(
  run: (dirs: { dataRoot: string; backupDir: string; restoreRoot: string }) => Promise<T>,
): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-backup-src-"));
  const backupDir = await mkdtemp(join(tmpdir(), "openagent-backup-pkg-"));
  const restoreRoot = await mkdtemp(join(tmpdir(), "openagent-backup-dst-"));
  try {
    return await run({ dataRoot, backupDir, restoreRoot });
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
    await rm(restoreRoot, { recursive: true, force: true });
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

function seedSessionForResume(
  db: ReturnType<typeof openWorkspaceDatabase>,
  sessionId: string,
  runId: string,
): void {
  const messageContentPut = db.putCasBlob(
    Buffer.from(JSON.stringify({ role: "user", text: "persistir backup" }), "utf8"),
  );
  const toolResultPut = db.putCasBlob(Buffer.from('{"stdout":"backup-ok"}', "utf8"));
  const attachmentPut = db.putCasBlob(Buffer.from("anexo backup", "utf8"));

  const modePayloadRef = putJsonPayload(db, { sessionId, mode: "agent" });
  const messagesPayloadRef = putJsonPayload(db, {
    sessionId,
    messages: [
      {
        id: "msg-backup-1",
        role: "user",
        status: "complete",
        contentRef: messageContentPut.contentRef,
        tokenCount: 11,
      },
    ],
  });
  const toolPayloadRef = putJsonPayload(db, {
    runId,
    invocation: {
      id: "tool-backup-1",
      tool: "read_file",
      target: "/projeto/y.ts",
      capability: "file.read",
      state: "complete",
      resultRef: toolResultPut.contentRef,
    },
  });
  const attachmentPayloadRef = putJsonPayload(db, {
    sessionId,
    attachments: [{ id: "att-backup-1", kind: "file", contentRef: attachmentPut.contentRef }],
  });

  db.appendHarnessEvent({
    runId,
    type: "session.mode",
    payloadRef: modePayloadRef,
    timestamp: 1_731_100_000_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "message.snapshot",
    payloadRef: messagesPayloadRef,
    timestamp: 1_731_100_001_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "tool.result",
    payloadRef: toolPayloadRef,
    timestamp: 1_731_100_002_000,
  });
  db.appendHarnessEvent({
    runId,
    type: "attachment.retained",
    payloadRef: attachmentPayloadRef,
    timestamp: 1_731_100_003_000,
  });
}

test("[SES-01] backup consistente SQLite + CAS restaurado reabre sessão com modo, mensagens, ferramentas e anexos", async () => {
  await withTempDirs(async ({ dataRoot, backupDir, restoreRoot }) => {
    const workspaceId = "ws-backup-restore";
    const sessionId = "sess-backup";
    const runId = "run-backup";

    const live = openWorkspaceDatabase({ dataRoot, workspaceId });
    const seedDb = new DatabaseSync(live.databasePath);
    seedWorkspaceSessionRun(seedDb, workspaceId, sessionId, runId);
    seedDb.close();

    seedSessionForResume(live, sessionId, runId);

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    const rawDb = new DatabaseSync(live.databasePath);
    createWorkspaceStorageBackup({
      database: rawDb,
      databasePath: live.databasePath,
      casRoot,
      workspaceId,
      backupDirectory: backupDir,
    });
    rawDb.close();
    live.close();

    restoreWorkspaceStorageBackup({
      backupDirectory: backupDir,
      dataRoot: restoreRoot,
      workspaceId,
    });

    const reopened = openWorkspaceDatabase({ dataRoot: restoreRoot, workspaceId });
    const messages = reopened.listMessages(sessionId);
    const tools = reopened.listToolInvocations(runId);
    const resumes = reopened.listSessionResumes();
    reopened.close();

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "msg-backup-1");
    assert.equal(messages[0]?.tokenCount, 11);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.tool, "read_file");
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0]?.mode, "agent");
    const attachments = JSON.parse(resumes[0]?.attachmentsJson ?? "[]") as { id: string }[];
    assert.equal(attachments[0]?.id, "att-backup-1");
  });
});

test("[SES-01] restore de backup inválido retorna INVALID_STATE sem alterar storage original", async () => {
  await withTempDirs(async ({ dataRoot, backupDir, restoreRoot }) => {
    const workspaceId = "ws-backup-invalid";
    const sessionId = "sess-backup-invalid";
    const runId = "run-backup-invalid";

    const live = openWorkspaceDatabase({ dataRoot, workspaceId });
    const seedDb = new DatabaseSync(live.databasePath);
    seedWorkspaceSessionRun(seedDb, workspaceId, sessionId, runId);
    seedDb.close();

    const messageRef = putJsonPayload(live, {
      sessionId,
      messages: [
        {
          id: "msg-still-here",
          role: "user",
          status: "complete",
          contentRef: live.putCasBlob(Buffer.from("{}", "utf8")).contentRef,
          tokenCount: 1,
        },
      ],
    });
    live.appendHarnessEvent({
      runId,
      type: "message.snapshot",
      payloadRef: messageRef,
      timestamp: 1,
    });
    live.rebuildProjectionsFromEventLog(sessionId);

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    const rawDb = new DatabaseSync(live.databasePath);
    createWorkspaceStorageBackup({
      database: rawDb,
      databasePath: live.databasePath,
      casRoot,
      workspaceId,
      backupDirectory: backupDir,
    });
    rawDb.close();

    await unlink(join(backupDir, "manifest.json"));

    assert.throws(
      () =>
        restoreWorkspaceStorageBackup({
          backupDirectory: backupDir,
          dataRoot: restoreRoot,
          workspaceId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(
      existsSync(join(restoreRoot, "workspaces", workspaceId, "state.sqlite3")),
      false,
    );

    const messagesBefore = live.listMessages(sessionId);
    live.close();
    assert.equal(messagesBefore.length, 1);
    assert.equal(messagesBefore[0]?.id, "msg-still-here");
  });
});
