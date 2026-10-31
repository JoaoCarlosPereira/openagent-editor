import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredSession,
  exportSessionTextFile,
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

test("[SES-02] exportação grava arquivo de texto com mensagens da sessão", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-export-"));
  const workspaceId = "ws-export";
  const sessionId = "sess-export";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspace(sqlite, workspaceId);
    createStoredSession(sqlite, {
      sessionId,
      workspaceId,
      mode: "agent",
    });
    sqlite.close();

    const userPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ role: "user", text: "primeira pergunta" }), "utf8"),
    );
    const assistantPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ role: "assistant", text: "resposta do agente" }), "utf8"),
    );

    db.putSessionResume({
      sessionId,
      mode: "agent",
      messagesJson: JSON.stringify([
        { role: "user", contentRef: userPut.contentRef },
        { role: "assistant", contentRef: assistantPut.contentRef },
      ]),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    const outputPath = join(dataRoot, "export", `${sessionId}.txt`);
    const sqliteExport = new DatabaseSync(db.databasePath);
    const result = exportSessionTextFile(sqliteExport, casRoot, { sessionId, outputPath });
    sqliteExport.close();
    db.close();

    assert.equal(result.sessionId, sessionId);
    assert.equal(result.messageCount, 2);
    assert.ok(result.byteSize > 0);

    const exported = readFileSync(outputPath, "utf8");
    assert.match(exported, /\[user\]\nprimeira pergunta/);
    assert.match(exported, /\[assistant\]\nresposta do agente/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-02] exportação via projeção message usa contentRef CAS", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-export-proj-"));
  const workspaceId = "ws-export-proj";
  const sessionId = "sess-proj-export";
  const runId = "run-export";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspace(sqlite, workspaceId);
    createStoredSession(sqlite, {
      sessionId,
      workspaceId,
      mode: "ask",
    });
    sqlite
      .prepare(
        `INSERT INTO run(id, session_id, parent_run_id, state, hypothesis, started_at, ended_at)
         VALUES (?, ?, NULL, 'complete', NULL, ?, NULL)`,
      )
      .run(runId, sessionId, new Date().toISOString());
    sqlite.close();

    const contentPut = db.putCasBlob(
      Buffer.from(JSON.stringify({ role: "user", text: "via message table" }), "utf8"),
    );
    db.insertMessage({
      id: "msg-export-1",
      sessionId,
      role: "user",
      status: "complete",
      contentRef: contentPut.contentRef,
      tokenCount: 4,
    });

    const outputPath = join(dataRoot, "sess-proj-export.txt");
    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    const sqliteExport = new DatabaseSync(db.databasePath);
    const result = exportSessionTextFile(sqliteExport, casRoot, { sessionId, outputPath });
    sqliteExport.close();
    db.close();

    assert.equal(result.messageCount, 1);
    assert.equal(readFileSync(outputPath, "utf8"), "[user]\nvia message table\n");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-02] caminho de erro retorna INVALID_STATE sem efeito colateral", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-export-err-"));
  const workspaceId = "ws-export-err";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    const sqlite = new DatabaseSync(db.databasePath);

    assert.throws(
      () =>
        exportSessionTextFile(sqlite, casRoot, {
          sessionId: "",
          outputPath: join(dataRoot, "out.txt"),
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () =>
        exportSessionTextFile(sqlite, casRoot, {
          sessionId: "sess-missing",
          outputPath: join(dataRoot, "out.txt"),
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    sqlite.close();
    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
