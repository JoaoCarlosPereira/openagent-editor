import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredCheckpoint,
  loadCheckpointRestorePayload,
  openWorkspaceDatabase,
} from "@openagent/storage";
import {
  buildCheckpointPatchFromFileChanges,
  restoreCheckpointOnWorkspace,
  sha256HexUtf8,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(os.tmpdir(), "openagent-checkpoint-restore-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function seedRun(database: DatabaseSync, workspaceId: string, runId: string): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
  database
    .prepare(
      `INSERT INTO session(id, workspace_id, mode, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run("sess-ckpt-restore", workspaceId, "agent", "2026-10-28T12:00:00.000Z");
  database
    .prepare(`INSERT INTO run(id, session_id, state, started_at) VALUES (?, ?, ?, ?)`)
    .run(runId, "sess-ckpt-restore", "running", "2026-10-28T12:01:00.000Z");
}

test("[SES-03] checkpoint.restore reverte só arquivos do run e preserva edição manual em outros paths", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-restore-ok";
    const runId = "run-restore-1";
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-restore-ws-"));
    const agentPath = "src/agent.ts";
    const manualPath = "src/manual.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });

    const agentBase = "export const agent = 1;\n";
    const agentResult = "export const agent = 2;\n";
    const manualContent = "export const manual = 99;\n";

    writeFileSync(path.join(workspaceRoot, agentPath), agentResult, "utf8");
    writeFileSync(path.join(workspaceRoot, manualPath), manualContent, "utf8");

    const baseHashes = { [agentPath]: sha256HexUtf8(agentBase) };
    const resultHashes = { [agentPath]: sha256HexUtf8(agentResult) };
    const patchText = buildCheckpointPatchFromFileChanges([
      {
        relativePath: agentPath,
        baseContent: agentBase,
        resultContent: agentResult,
      },
    ]);

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    seedRun(sqlite, workspaceId, runId);
    const casRoot = path.join(dataRoot, "workspaces", workspaceId, "cas");
    const created = createStoredCheckpoint(sqlite, casRoot, {
      runId,
      baseHashes,
      resultHashes,
      patchText,
    });

    const loaded = loadCheckpointRestorePayload(sqlite, casRoot, created.checkpointId);
    const outcome = restoreCheckpointOnWorkspace(workspaceRoot, {
      baseHashes: loaded.baseHashes,
      resultHashes: loaded.resultHashes,
      patchText: loaded.patchText,
    });

    assert.deepEqual(outcome, { restored: true });
    assert.equal(readFileSync(path.join(workspaceRoot, agentPath), "utf8"), agentBase);
    assert.equal(readFileSync(path.join(workspaceRoot, manualPath), "utf8"), manualContent);

    sqlite.close();
    db.close();
  });
});

test("[SES-03] checkpoint.restore retorna conflito sem gravar quando arquivo do run foi editado manualmente", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-restore-conflict";
    const runId = "run-restore-2";
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-restore-conflict-"));
    const agentPath = "src/feature.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });

    const agentBase = "export const v = 1;\n";
    const agentResult = "export const v = 2;\n";
    const manualEdit = "export const v = 3;\n";

    writeFileSync(path.join(workspaceRoot, agentPath), manualEdit, "utf8");

    const patchText = buildCheckpointPatchFromFileChanges([
      {
        relativePath: agentPath,
        baseContent: agentBase,
        resultContent: agentResult,
      },
    ]);

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    seedRun(sqlite, workspaceId, runId);
    const casRoot = path.join(dataRoot, "workspaces", workspaceId, "cas");
    const created = createStoredCheckpoint(sqlite, casRoot, {
      runId,
      baseHashes: { [agentPath]: sha256HexUtf8(agentBase) },
      resultHashes: { [agentPath]: sha256HexUtf8(agentResult) },
      patchText,
    });

    const loaded = loadCheckpointRestorePayload(sqlite, casRoot, created.checkpointId);
    const outcome = restoreCheckpointOnWorkspace(workspaceRoot, {
      baseHashes: loaded.baseHashes,
      resultHashes: loaded.resultHashes,
      patchText: loaded.patchText,
    });

    assert.deepEqual(outcome, { conflict: true });
    assert.equal(readFileSync(path.join(workspaceRoot, agentPath), "utf8"), manualEdit);

    sqlite.close();
    db.close();
  });
});

test("[SES-03] checkpoint.restore rejeita checkpoint inexistente com INVALID_STATE", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-restore-invalid";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    const casRoot = path.join(dataRoot, "workspaces", workspaceId, "cas");

    assert.throws(
      () => loadCheckpointRestorePayload(sqlite, casRoot, "00000000-0000-4000-8000-000000000000"),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    sqlite.close();
    db.close();
  });
});
