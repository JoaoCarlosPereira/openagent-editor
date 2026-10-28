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
import { STANDARD_LOG_REDACTED } from "@openagent/policy";
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  TOOL_RESULT_EVENT,
  persistToolInvocationResult,
} from "../../src/worker/tool-invocation-record.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-tool-inv-"));
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
    .run("sess-agent", workspaceId, "agent", "main", "2026-10-28T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO run(id, session_id, state, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(runId, "sess-agent", "running", "2026-10-28T00:01:00.000Z");
}

test("[AGT-03] Registro de ToolInvocation persiste resultado no CAS e projeção por ferramenta", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-tool-inv";
    const runId = "run-agent-67";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    const writer = {
      putCasBlob: (data: Buffer) => db.putCasBlob(data),
      appendHarnessEvent: (input: Parameters<typeof db.appendHarnessEvent>[0]) =>
        db.appendHarnessEvent(input),
      applyHarnessEventToProjections: (event: Parameters<typeof db.applyHarnessEventToProjections>[0]) =>
        db.applyHarnessEventToProjections(event),
    };

    persistToolInvocationResult(writer, {
      runId,
      invocation: {
        id: "tool-inv-write-a",
        tool: "file.write",
        target: "src/a.ts",
        capability: "file.write",
        state: "complete",
      },
      result: { applied: true, path: "src/a.ts" },
      durationMs: 12,
    });

    persistToolInvocationResult(writer, {
      runId,
      invocation: {
        id: "tool-inv-shell-test",
        tool: "shell.run",
        target: "npm test",
        capability: "shell.execute",
        state: "complete",
      },
      result: { exitCode: 0, stdout: "ok", stderr: "" },
      durationMs: 340,
    });

    const tools = db.listToolInvocations(runId);
    const events = db.listHarnessEvents(runId);
    db.close();

    assert.equal(tools.length, 2);
    assert.ok(tools.every((tool) => tool.resultRef));
    assert.deepEqual(
      tools.map((tool) => tool.id).sort(),
      ["tool-inv-shell-test", "tool-inv-write-a"],
    );

    const stream = validateHarnessEventStream(events);
    assert.equal(stream.valid, true);
    if (stream.valid && stream.events) {
      assert.deepEqual(
        stream.events.map((event) => event.type),
        [TOOL_RESULT_EVENT, TOOL_RESULT_EVENT],
      );
    }
  });
});

test("[PRV-02] Log padrão registra ação de ferramenta sem credencial, conteúdo excluído ou corpo bruto do modelo", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-tool-log";
    const runId = "run-log-67";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    const logLines: string[] = [];
    persistToolInvocationResult(
      {
        putCasBlob: (data: Buffer) => db.putCasBlob(data),
        appendHarnessEvent: (input) => db.appendHarnessEvent(input),
        applyHarnessEventToProjections: (event) => db.applyHarnessEventToProjections(event),
      },
      {
        runId,
        invocation: {
          id: "tool-inv-log",
          tool: "file.read",
          target: "secret.env",
          capability: "file.read",
          state: "complete",
        },
        result: { content: "API_KEY=super-secret" },
        log: {
          tool: "file.read",
          target: "secret.env",
          credential: "Bearer top-secret",
          excludedFileContent: "conteúdo de arquivo excluído",
          rawModelResponseBody: "resposta bruta do modelo",
        },
      },
      { logSink: (line) => logLines.push(line) },
    );

    db.close();
    assert.equal(logLines.length, 1);
    const parsed = JSON.parse(logLines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed.tool, "file.read");
    assert.equal(parsed.credential, STANDARD_LOG_REDACTED);
    assert.equal(parsed.excludedFileContent, STANDARD_LOG_REDACTED);
    assert.equal(parsed.rawModelResponseBody, STANDARD_LOG_REDACTED);
    assert.ok(!JSON.stringify(parsed).includes("super-secret"));
    assert.ok(!JSON.stringify(parsed).includes("top-secret"));
  });
});

test("[AGT-03] entrada inválida retorna INVALID_STATE sem append de evento", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-tool-invalid";
    const runId = "run-invalid-67";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    assert.throws(
      () =>
        persistToolInvocationResult(
          {
            putCasBlob: (data: Buffer) => db.putCasBlob(data),
            appendHarnessEvent: (input) => db.appendHarnessEvent(input),
          },
          {
            runId: "",
            invocation: {
              id: "x",
              tool: "file.read",
              target: "a.ts",
              capability: "file.read",
              state: "complete",
            },
            result: { ok: true },
          },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const events = db.listHarnessEvents(runId);
    db.close();
    assert.equal(events.length, 0);
  });
});
