import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateHarnessEventStream,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-event-log-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function seedWorkspaceRun(database: DatabaseSync, workspaceId: string, runId: string): void {
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
    .run("sess-elog", workspaceId, "agent", "main", "2026-10-28T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO run(id, session_id, state, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(runId, "sess-elog", "running", "2026-10-28T00:01:00.000Z");
}

test("[SES-01] event log append-only persiste sequence monotônico após reinício", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-event-log";
    const runId = "run-elog";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = first.databasePath;
    const database = new DatabaseSync(databasePath);
    seedWorkspaceRun(database, workspaceId, runId);
    database.close();

    const appendedA = first.appendHarnessEvent({
      runId,
      type: "run.started",
      payloadRef: "cas:aaa",
      timestamp: 1_731_000_000_000,
    });
    const appendedB = first.appendHarnessEvent({
      runId,
      type: "message.delta",
      payloadRef: "cas:bbb",
      timestamp: 1_731_000_001_000,
    });
    first.close();

    const second = openWorkspaceDatabase({ dataRoot, workspaceId });
    const events = second.listHarnessEvents(runId);
    second.close();

    assert.equal(appendedA.sequence, 1);
    assert.equal(appendedB.sequence, 2);
    assert.deepEqual(events, [appendedA, appendedB]);

    const streamCheck = validateHarnessEventStream(events);
    assert.equal(streamCheck.valid, true);
    if (streamCheck.valid && streamCheck.events) {
      assert.equal(streamCheck.events.length, 2);
      assert.equal(streamCheck.events[1]?.sequence, 2);
    }
  });
});

test("[SES-01] entrada inválida retorna INVALID_STATE sem persistir evento", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-event-invalid";
    const runId = "run-invalid";

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(database, workspaceId, runId);
    database.close();

    assert.throws(
      () =>
        db.appendHarnessEvent({
          runId,
          type: "   ",
          payloadRef: "cas:empty-type",
          timestamp: 1,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const events = db.listHarnessEvents();
    db.close();
    assert.equal(events.length, 0);
  });
});
