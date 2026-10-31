import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredSession,
  listStoredSessionsByWorkspace,
  openWorkspaceDatabase,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-sess-repo-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function seedWorkspace(database: DatabaseSync, workspaceId: string): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
}

test("[SES-01] repositório cria e lista sessões por workspace após reinício do editor", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-sess-repo";
    const boot = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = boot.databasePath;
    boot.close();

    const setup = new DatabaseSync(databasePath);
    seedWorkspace(setup, workspaceId);
    createStoredSession(setup, {
      sessionId: "sess-a",
      workspaceId,
      mode: "agent",
      branchId: "main",
      createdAt: "2026-10-28T10:00:00.000Z",
    });
    createStoredSession(setup, {
      sessionId: "sess-b",
      workspaceId,
      mode: "debug",
      createdAt: "2026-10-28T11:00:00.000Z",
    });
    setup.close();

    const writer = openWorkspaceDatabase({ dataRoot, workspaceId });
    writer.putSessionResume({
      sessionId: "sess-a",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", text: "continuar" }]),
      toolsJson: JSON.stringify([{ name: "read", state: "ready" }]),
      attachmentsJson: JSON.stringify([{ id: "att-1", kind: "selection" }]),
    });
    writer.close();

    const reopened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(reopened.databasePath);
    const listed = listStoredSessionsByWorkspace(database, workspaceId);
    database.close();
    reopened.close();

    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.id, "sess-a");
    assert.equal(listed[0]?.mode, "agent");
    assert.deepEqual(JSON.parse(listed[0]?.messagesJson ?? "[]"), [
      { role: "user", text: "continuar" },
    ]);
    assert.deepEqual(JSON.parse(listed[0]?.toolsJson ?? "[]"), [
      { name: "read", state: "ready" },
    ]);
    assert.deepEqual(JSON.parse(listed[0]?.attachmentsJson ?? "[]"), [
      { id: "att-1", kind: "selection" },
    ]);
    assert.equal(listed[1]?.id, "sess-b");
    assert.equal(listed[1]?.mode, "debug");
    assert.deepEqual(JSON.parse(listed[1]?.messagesJson ?? "[]"), []);
  });
});

test("[SES-01] entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-sess-invalid";
    const boot = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = boot.databasePath;
    boot.close();

    const database = new DatabaseSync(databasePath);
    seedWorkspace(database, workspaceId);

    assert.throws(
      () =>
        createStoredSession(database, {
          sessionId: "",
          workspaceId,
          mode: "agent",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    createStoredSession(database, {
      sessionId: "sess-dup",
      workspaceId,
      mode: "agent",
    });

    assert.throws(
      () =>
        createStoredSession(database, {
          sessionId: "sess-dup",
          workspaceId,
          mode: "plan",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () =>
        createStoredSession(database, {
          sessionId: "sess-no-ws",
          workspaceId: "ws-missing-row",
          mode: "agent",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => listStoredSessionsByWorkspace(database, ".."),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const count = database.prepare("SELECT COUNT(*) AS c FROM session").get() as { c: number };
    assert.equal(count.c, 1);

    database.close();
  });
});
