import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredCheckpoint,
  getStoredCheckpointById,
  openWorkspaceDatabase,
  readCheckpointHashesFromRef,
  readCheckpointPatchFromRef,
  STORAGE_SCHEMA_VERSION,
} from "@openagent/storage";
import {
  buildCheckpointHashesFromAgentWriteBatch,
  executeAgentFileWriteBatch,
  sha256HexUtf8,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(os.tmpdir(), "openagent-checkpoint-"));
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
    .run("sess-ckpt", workspaceId, "agent", "2026-10-28T12:00:00.000Z");
  database
    .prepare(`INSERT INTO run(id, session_id, state, started_at) VALUES (?, ?, ?, ?)`)
    .run(runId, "sess-ckpt", "running", "2026-10-28T12:01:00.000Z");
}

test("[SES-03] checkpoint.create persiste baseHashes, resultHashes e patchRef por execução", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-checkpoint";
    const runId = "run-ckpt-1";
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-ckpt-files-"));
    const relativePath = "src/feature.ts";
    mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, relativePath), "export const v = 1;\n", "utf8");

    const batch = executeAgentFileWriteBatch(workspaceRoot, "agent", [
      {
        relativePath,
        expectedContentHashHex: sha256HexUtf8("export const v = 1;\n"),
        newContent: "export const v = 2;\n",
      },
    ]);
    const { baseHashes, resultHashes } = buildCheckpointHashesFromAgentWriteBatch(batch);
    const patchText = batch.groupedDiff;

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    seedRun(sqlite, workspaceId, runId);

    const casRoot = path.join(dataRoot, "workspaces", workspaceId, "cas");
    const created = createStoredCheckpoint(sqlite, casRoot, {
      runId,
      label: "after agent edit",
      baseHashes,
      resultHashes,
      patchText,
    });

    assert.ok(created.checkpointId);
    assert.equal(created.runId, runId);
    assert.match(created.baseHashesRef, /^sha256:[a-f0-9]{64}$/);
    assert.match(created.patchRef, /^sha256:[a-f0-9]{64}$/);

    const loaded = getStoredCheckpointById(sqlite, created.checkpointId);
    assert.ok(loaded);
    if (!loaded) {
      return;
    }
    assert.equal(loaded.label, "after agent edit");

    const roundTripBase = readCheckpointHashesFromRef(sqlite, casRoot, loaded.baseHashesRef);
    const roundTripResult = readCheckpointHashesFromRef(sqlite, casRoot, loaded.resultHashesRef);
    assert.deepEqual(roundTripBase, baseHashes);
    assert.deepEqual(roundTripResult, resultHashes);
    assert.equal(readCheckpointPatchFromRef(sqlite, casRoot, loaded.patchRef), patchText);

    sqlite.close();
    db.close();
  });
});

test("[SES-03] checkpoint.create rejeita run inexistente ou hashes inconsistentes", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-checkpoint-err";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    const casRoot = path.join(dataRoot, "workspaces", workspaceId, "cas");

    const hashA = sha256HexUtf8("a");
    const hashB = sha256HexUtf8("b");

    assert.throws(
      () =>
        createStoredCheckpoint(sqlite, casRoot, {
          runId: "missing-run",
          baseHashes: { "a.ts": hashA },
          resultHashes: { "a.ts": hashB },
          patchText: "diff",
        }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    seedRun(sqlite, workspaceId, "run-valid");
    assert.throws(
      () =>
        createStoredCheckpoint(sqlite, casRoot, {
          runId: "run-valid",
          baseHashes: { "a.ts": hashA },
          resultHashes: { "b.ts": hashB },
          patchText: "diff",
        }),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );

    sqlite.close();
    db.close();
  });
});

test("[SES-03] migração 008 expõe schema_version 8", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-schema-8" });
    const sqlite = new DatabaseSync(db.databasePath);
    const row = sqlite
      .prepare("SELECT value FROM storage_meta WHERE key = 'schema_version'")
      .get() as { value?: string };
    assert.equal(Number(row.value), STORAGE_SCHEMA_VERSION);
    assert.equal(STORAGE_SCHEMA_VERSION, 9);
    sqlite.close();
    db.close();
  });
});
