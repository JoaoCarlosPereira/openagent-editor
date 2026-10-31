import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredSession,
  forkStoredSession,
  listStoredSessionsByWorkspace,
  openWorkspaceDatabase,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-sess-fork-"));
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

test("[SES-06] fork de sessão preserva mensagens da conversa principal", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-fork-ses06";
    const boot = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = boot.databasePath;
    boot.close();

    const setup = new DatabaseSync(databasePath);
    seedWorkspace(setup, workspaceId);
    createStoredSession(setup, {
      sessionId: "sess-principal",
      workspaceId,
      mode: "agent",
    });
    setup.close();

    const writer = openWorkspaceDatabase({ dataRoot, workspaceId });
    const parentMessages = [{ role: "user", text: "primeira pergunta" }];
    writer.putSessionResume({
      sessionId: "sess-principal",
      mode: "agent",
      messagesJson: JSON.stringify(parentMessages),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });

    const database = new DatabaseSync(writer.databasePath);
    const forkResult = forkStoredSession(database, {
      parentSessionId: "sess-principal",
      forkSessionId: "sess-lateral",
    });
    database.close();

    writer.putSessionResume({
      sessionId: "sess-lateral",
      mode: "agent",
      messagesJson: JSON.stringify([
        ...parentMessages,
        { role: "user", text: "pergunta só na lateral" },
      ]),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });
    writer.close();

    const reader = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(reader.databasePath);
    const listed = listStoredSessionsByWorkspace(sqlite, workspaceId);
    sqlite.close();
    reader.close();

    assert.equal(forkResult.fork.branchId, "sess-principal");
    assert.equal(listed.length, 2);

    const principal = listed.find((s) => s.id === "sess-principal");
    const lateral = listed.find((s) => s.id === "sess-lateral");
    assert.ok(principal);
    assert.ok(lateral);

    assert.deepEqual(JSON.parse(principal.messagesJson), parentMessages);
    assert.deepEqual(JSON.parse(lateral.messagesJson), [
      ...parentMessages,
      { role: "user", text: "pergunta só na lateral" },
    ]);
  });
});

test("[SES-06] caminho de erro retorna INVALID_STATE sem efeito colateral", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-fork-invalid";
    const boot = openWorkspaceDatabase({ dataRoot, workspaceId });
    const databasePath = boot.databasePath;
    boot.close();

    const database = new DatabaseSync(databasePath);
    seedWorkspace(database, workspaceId);
    createStoredSession(database, {
      sessionId: "sess-ok",
      workspaceId,
      mode: "ask",
    });

    assert.throws(
      () =>
        forkStoredSession(database, {
          parentSessionId: "",
          forkSessionId: "fork-a",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () =>
        forkStoredSession(database, {
          parentSessionId: "sess-missing",
          forkSessionId: "fork-b",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    forkStoredSession(database, {
      parentSessionId: "sess-ok",
      forkSessionId: "fork-dup",
    });

    assert.throws(
      () =>
        forkStoredSession(database, {
          parentSessionId: "sess-ok",
          forkSessionId: "fork-dup",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const count = database.prepare("SELECT COUNT(*) AS c FROM session").get() as { c: number };
    assert.equal(count.c, 2);

    database.close();
  });
});
