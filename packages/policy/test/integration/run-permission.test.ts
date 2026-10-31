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
import { openWorkspaceDatabase } from "@openagent/storage";
import {
  RUN_PERMISSION_DECIDED_EVENT,
  RUN_PERMISSION_REQUESTED_EVENT,
  RunToolPermissionFlow,
  assertRunToolMayExecute,
  createLocalStructuredLogger,
  persistPermissionDecidedEvent,
  persistPermissionRequestedEvent,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-run-perm-"));
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
    .run("sess-perm", workspaceId, "agent", "main", "2026-10-28T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO run(id, session_id, state, started_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(runId, "sess-perm", "running", "2026-10-28T00:01:00.000Z");
}

test("[PER-01] Pedido no run emite evento com ação, alvo e escopo; execução só após allow", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-run-perm";
    const runId = "run-perm-57";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    const flow = new RunToolPermissionFlow();
    const prepared = flow.requestPermission({
      runId,
      sessionId: "sess-perm",
      request: {
        requestId: "perm-run-57",
        capability: "file.write",
        target: { kind: "path", path: "src/main.ts" },
      },
    });

    assert.equal(prepared.phase, "pending");
    if (prepared.phase !== "pending") {
      return;
    }

    assert.equal(prepared.prompt.action, "Gravar arquivo");
    assert.equal(prepared.prompt.target, "src/main.ts");
    assert.equal(prepared.canExecute, false);

    const logLines: string[] = [];
    createLocalStructuredLogger({ runId, sessionId: "sess-perm" }, (line) => logLines.push(line)).write({
      level: "info",
      message: "Pedido de permissão emitido no run.",
      runId,
      sessionId: "sess-perm",
      tool: prepared.prompt.action,
      state: "permission.pending",
      permissionRequestId: prepared.request.requestId,
      target: prepared.prompt.target,
      scopeLabel: prepared.prompt.scopeLabel,
    });
    assert.ok(logLines.some((line) => line.includes("permission.pending")));

    assert.throws(() => assertRunToolMayExecute(prepared.gate), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      return true;
    });

    const context = { runId, sessionId: "sess-perm" };
    const requestedEvent = persistPermissionRequestedEvent(
      db,
      context,
      prepared.request,
      prepared.gate,
      1_731_000_100_000,
    );
    assert.equal(requestedEvent.type, RUN_PERMISSION_REQUESTED_EVENT);

    const decided = flow.decide(prepared.request.requestId, "allow", "once");
    assert.equal(decided.canExecute, true);
    persistPermissionDecidedEvent(db, decided.context, decided.gate);

    assert.doesNotThrow(() => assertRunToolMayExecute(decided.gate));

    const events = db.listHarnessEvents(runId);
    db.close();
    assert.equal(events.length, 2);
    assert.equal(events[0]?.type, RUN_PERMISSION_REQUESTED_EVENT);
    assert.equal(events[1]?.type, RUN_PERMISSION_DECIDED_EVENT);
    const streamCheck = validateHarnessEventStream(events);
    assert.equal(streamCheck.valid, true);
  });
});

test("[PER-01] Caminho de erro: entrada inválida retorna INVALID_STATE sem append de evento", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-run-perm-err";
    const runId = "run-perm-err";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    const flow = new RunToolPermissionFlow();
    assert.throws(
      () =>
        flow.requestPermission({
          runId,
          sessionId: "sess-perm",
          request: {
            requestId: "",
            capability: "file.write",
            target: { kind: "path", path: "x.ts" },
          },
        }),
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

test("[PER-01] Negação explícita impede execução após evento decidido", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-run-perm-deny";
    const runId = "run-perm-deny";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    seedWorkspaceRun(sqlite, workspaceId, runId);
    sqlite.close();

    const flow = new RunToolPermissionFlow();
    const prepared = flow.requestPermission({
      runId,
      sessionId: "sess-perm",
      request: {
        requestId: "perm-deny",
        capability: "shell.exec",
        target: { kind: "command", command: "npm test" },
      },
    });
    assert.equal(prepared.phase, "pending");
    if (prepared.phase !== "pending") {
      return;
    }

    persistPermissionRequestedEvent(
      db,
      { runId, sessionId: "sess-perm" },
      prepared.request,
      prepared.gate,
    );

    const denied = flow.decide(prepared.request.requestId, "deny", "once");
    assert.equal(denied.canExecute, false);
    persistPermissionDecidedEvent(db, denied.context, denied.gate);

    assert.throws(() => assertRunToolMayExecute(denied.gate), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      return true;
    });

    db.close();
  });
});
