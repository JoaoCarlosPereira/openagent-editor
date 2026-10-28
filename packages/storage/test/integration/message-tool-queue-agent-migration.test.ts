import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { openWorkspaceDatabase, STORAGE_SCHEMA_VERSION } from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-proj-"));
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
  mode = "agent",
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

test("[SES-01] migração 005 cria projeções message, tool_invocation, queue_item e agent_node", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-proj-migrate";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(db.databasePath);
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('message', 'tool_invocation', 'queue_item', 'agent_node')
         ORDER BY name`,
      )
      .all() as { name: string }[];
    const schemaVersion = database
      .prepare("SELECT value FROM storage_meta WHERE key = 'schema_version'")
      .get() as { value: string };
    database.close();
    db.close();

    assert.deepEqual(
      tables.map((row) => row.name),
      ["agent_node", "message", "queue_item", "tool_invocation"],
    );
    assert.equal(schemaVersion.value, String(STORAGE_SCHEMA_VERSION));
    assert.equal(STORAGE_SCHEMA_VERSION, 5);
  });
});

test("[SES-01] mensagens e ferramentas persistem após reinício do editor", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-proj-ses";
    const sessionId = "sess-proj";
    const runId = "run-proj";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(first.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId, "debug");
    database.close();

    const contentPut = first.putCasBlob(
      Buffer.from(JSON.stringify({ role: "user", text: "persistir" }), "utf8"),
    );
    const toolResultPut = first.putCasBlob(Buffer.from('{"stdout":"ok"}', "utf8"));

    first.insertMessage({
      id: "msg-1",
      sessionId,
      role: "user",
      status: "complete",
      contentRef: contentPut.contentRef,
      tokenCount: 12,
    });
    first.insertToolInvocation({
      id: "tool-1",
      runId,
      tool: "read_file",
      target: "/projeto/a.ts",
      capability: "file.read",
      state: "complete",
      resultRef: toolResultPut.contentRef,
    });
    first.close();

    const second = openWorkspaceDatabase({ dataRoot, workspaceId });
    const messages = second.listMessages(sessionId);
    const tools = second.listToolInvocations(runId);
    assert.equal(messages.length, 1);
    const message = messages[0];
    assert.ok(message);
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.ok(tool);
    const restoredContent = JSON.parse(
      Buffer.from(second.readCasBlob(message.contentRef)).toString("utf8"),
    ) as { text: string };
    assert.ok(tool.resultRef);
    const restoredTool = JSON.parse(
      Buffer.from(second.readCasBlob(tool.resultRef)).toString("utf8"),
    ) as { stdout: string };
    second.close();

    assert.equal(message.role, "user");
    assert.equal(message.tokenCount, 12);
    assert.equal(restoredContent.text, "persistir");
    assert.equal(tool.tool, "read_file");
    assert.equal(restoredTool.stdout, "ok");
  });
});

test("[AGT-05] subagentes locais persistem nome, estado e resultado após reinício", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-agt5";
    const sessionId = "sess-agt5";
    const runId = "run-agt5";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(first.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId);
    database.close();

    const resultPut = first.putCasBlob(Buffer.from('{"summary":"feito"}', "utf8"));
    first.insertAgentNode({
      id: "agent-parent",
      runId,
      parentId: null,
      name: "coordenador",
      state: "running",
      resultRef: null,
    });
    first.insertAgentNode({
      id: "agent-child",
      runId,
      parentId: "agent-parent",
      name: "pesquisador",
      state: "complete",
      resultRef: resultPut.contentRef,
    });
    first.close();

    const second = openWorkspaceDatabase({ dataRoot, workspaceId });
    const nodes = second.listAgentNodes(runId);
    const child = nodes.find((node) => node.id === "agent-child");
    assert.ok(child);
    assert.ok(child.resultRef);
    const restored = JSON.parse(
      Buffer.from(second.readCasBlob(child.resultRef)).toString("utf8"),
    ) as { summary: string };
    second.close();

    assert.equal(nodes.length, 2);
    assert.equal(child?.name, "pesquisador");
    assert.equal(child?.state, "complete");
    assert.equal(restored.summary, "feito");
  });
});

test("[AGT-06] fila persiste e remove item pending que ainda não começou", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-agt6";
    const sessionId = "sess-agt6";
    const runId = "run-agt6";

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(first.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId);
    database.close();

    const payloadPut = first.putCasBlob(Buffer.from('{"text":"fila"}', "utf8"));
    first.insertQueueItem({
      id: "q-pending",
      runId,
      ordinal: 0,
      payloadRef: payloadPut.contentRef,
      state: "pending",
    });
    first.insertQueueItem({
      id: "q-started",
      runId,
      ordinal: 1,
      payloadRef: payloadPut.contentRef,
      state: "started",
    });
    first.removePendingQueueItem(runId, "q-pending");
    first.close();

    const second = openWorkspaceDatabase({ dataRoot, workspaceId });
    const queue = second.listQueueItems(runId);
    second.close();

    assert.deepEqual(
      queue.map((item) => ({ id: item.id, state: item.state })),
      [{ id: "q-started", state: "started" }],
    );
  });
});

test("[SES-01] entrada inválida retorna INVALID_STATE sem persistir projeção", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-proj-invalid";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });

    assert.throws(
      () =>
        db.insertMessage({
          id: "msg-bad",
          sessionId: "sess-inexistente",
          role: "user",
          status: "complete",
          contentRef: "sha256:deadbeef",
          tokenCount: 1,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const messages = db.listMessages("sess-inexistente");
    db.close();
    assert.equal(messages.length, 0);
  });
});

test("[AGT-06] remover item started retorna INVALID_STATE sem apagar fila", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-agt6-invalid";
    const sessionId = "sess-agt6-invalid";
    const runId = "run-agt6-invalid";

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(db.databasePath);
    seedWorkspaceSessionRun(database, workspaceId, sessionId, runId);
    database.close();

    db.insertQueueItem({
      id: "q-started",
      runId,
      ordinal: 0,
      payloadRef: "sha256:abc",
      state: "started",
    });

    assert.throws(
      () => db.removePendingQueueItem(runId, "q-started"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const queue = db.listQueueItems(runId);
    db.close();
    assert.equal(queue.length, 1);
    const item = queue[0];
    assert.ok(item);
    assert.equal(item.state, "started");
  });
});
