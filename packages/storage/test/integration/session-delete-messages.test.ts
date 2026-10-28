import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  createStoredSession,
  listStoredSessionsByWorkspace,
  openWorkspaceDatabase,
} from "../../src/index.js";

function seedWorkspace(database: DatabaseSync, workspaceId: string): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
}

test("[SES-07] apagar sessão persistida remove linhas da tabela message", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-delete-msg-"));
  const workspaceId = "ws-delete-msg";
  const sessionId = "sess-normalized";
  try {
    const boot = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = boot.databasePath;
    boot.close();

    const sqlite = new DatabaseSync(databasePath);
    seedWorkspace(sqlite, workspaceId);
    createStoredSession(sqlite, { sessionId, workspaceId, mode: "agent" });
    sqlite.close();

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const blob = db.putCasBlob(Buffer.from('{"role":"user","text":"oi"}', "utf8"));
    db.insertMessage({
      id: "msg-1",
      sessionId,
      role: "user",
      status: "complete",
      contentRef: blob.contentRef,
      tokenCount: 4,
    });

    assert.equal(db.listMessages(sessionId).length, 1);
    assert.equal(listStoredSessionsByWorkspace(new DatabaseSync(databasePath), workspaceId).length, 1);

    const result = db.deleteSession(sessionId);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.releasedRefCount, 1);
    assert.deepEqual(db.listMessages(sessionId), []);
    assert.deepEqual(db.listSessionResumes(), []);

    const check = new DatabaseSync(databasePath);
    const sessionRow = check
      .prepare("SELECT id FROM session WHERE id = ?")
      .get(sessionId) as { id?: string } | undefined;
    const messageCount = check
      .prepare("SELECT COUNT(*) AS total FROM message WHERE session_id = ?")
      .get(sessionId) as { total: number };
    assert.equal(sessionRow?.id, undefined);
    assert.equal(messageCount.total, 0);
    assert.deepEqual(listStoredSessionsByWorkspace(check, workspaceId), []);
    check.close();

    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
