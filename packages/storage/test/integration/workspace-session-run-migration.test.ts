import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { openWorkspaceDatabase, resolveWorkspaceDatabasePath } from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-wsr-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

test("[SES-01] migração workspace/session/run persiste após reinício do editor", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-core";
    const opened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = opened.databasePath;
    opened.close();

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON");
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
      .run("sess-1", workspaceId, "agent", "main", "2026-10-28T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO run(id, session_id, state, started_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("run-1", "sess-1", "running", "2026-10-28T00:01:00.000Z");
    database.close();

    const reopened = new DatabaseSync(databasePath);
    const session = reopened
      .prepare(
        `SELECT id, workspace_id AS workspaceId, mode FROM session WHERE id = ?`,
      )
      .get("sess-1") as { id: string; workspaceId: string; mode: string };
    const run = reopened
      .prepare(`SELECT id, session_id AS sessionId, state FROM run WHERE id = ?`)
      .get("run-1") as { id: string; sessionId: string; state: string };
    reopened.close();

    assert.equal(session.workspaceId, workspaceId);
    assert.equal(session.mode, "agent");
    assert.equal(run.sessionId, "sess-1");
    assert.equal(run.state, "running");
  });
});

test("[SES-01] reinício mantém session_resume com modo, mensagens, ferramentas e anexos", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const record = {
      sessionId: "sess-resume",
      mode: "debug",
      messagesJson: JSON.stringify([{ role: "user", text: "trace" }]),
      toolsJson: JSON.stringify([{ name: "shell", state: "ok" }]),
      attachmentsJson: JSON.stringify([{ id: "att", kind: "selection" }]),
    };

    const first = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-resume" });
    first.putSessionResume(record);
    first.close();

    const second = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-resume" });
    const sessions = second.listSessionResumes();
    second.close();

    assert.deepEqual(sessions, [record]);
  });
});

test("[SES-01] workspaceId inválido retorna INVALID_STATE sem criar arquivo SQLite", async () => {
  await withTempDataRoot(async (dataRoot) => {
    assert.throws(
      () => openWorkspaceDatabase({ dataRoot, workspaceId: ".." }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => resolveWorkspaceDatabasePath(dataRoot, ".."),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  });
});
