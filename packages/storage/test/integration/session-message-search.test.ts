import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createStoredSession, openWorkspaceDatabase } from "../../src/index.js";

function seedWorkspace(database: DatabaseSync, workspaceId: string): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
}

test("[SES-05] busca FTS5 lista mensagens da sessão que contêm o texto", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-search-"));
  const workspaceId = "ws-search";
  const sessionId = "sess-search";
  const runId = "run-search";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspace(sqlite, workspaceId);
    createStoredSession(sqlite, {
      sessionId,
      workspaceId,
      mode: "agent",
    });
    sqlite
      .prepare(
        `INSERT INTO run(id, session_id, state) VALUES (?, ?, ?)`,
      )
      .run(runId, sessionId, "idle");
    sqlite.close();

    const alphaPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ text: "alpha sobre refatoração de módulos" }), "utf8"),
    );
    const betaPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ text: "beta fala de deploy e pipelines" }), "utf8"),
    );
    const gammaPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ text: "gamma menciona refatoração novamente" }), "utf8"),
    );

    db.insertMessage({
      id: "msg-a",
      sessionId,
      role: "user",
      status: "complete",
      contentRef: alphaPut.contentRef,
      tokenCount: 10,
    });
    db.insertMessage({
      id: "msg-b",
      sessionId,
      role: "assistant",
      status: "complete",
      contentRef: betaPut.contentRef,
      tokenCount: 12,
    });
    db.insertMessage({
      id: "msg-c",
      sessionId,
      role: "user",
      status: "complete",
      contentRef: gammaPut.contentRef,
      tokenCount: 11,
    });

    const result = db.searchSessionMessages({
      sessionId,
      query: "refatoração",
    });
    db.close();

    assert.equal(result.sessionId, sessionId);
    assert.equal(result.hits.length, 2);
    assert.deepEqual(
      result.hits.map((hit) => hit.id),
      ["msg-a", "msg-c"],
    );
    assert.ok(result.hits[0]?.lexicalSnippet.includes("refatoração"));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-05] caminho de erro retorna INVALID_STATE sem efeito colateral", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-search-err-"));
  const workspaceId = "ws-search-err";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });

    assert.throws(
      () => db.searchSessionMessages({ sessionId: "   ", query: "texto" }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    assert.throws(
      () => db.searchSessionMessages({ sessionId: "sess-inexistente", query: "texto" }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspace(sqlite, workspaceId);
    createStoredSession(sqlite, {
      sessionId: "sess-vazia",
      workspaceId,
      mode: "ask",
    });
    sqlite.close();

    assert.throws(
      () => db.searchSessionMessages({ sessionId: "sess-vazia", query: "   " }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
