import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  createStoredIsolatedWork,
  finalizeStoredIsolatedWork,
  getStoredIsolatedWorkRecordById,
  openWorkspaceDatabase,
} from "@openagent/storage";
import {
  createIsolatedGitWork,
  discardIsolatedGitWork,
  finalizeIsolatedGitWork,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(os.tmpdir(), "openagent-isolated-finalize-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function initGitRepo(workspaceRoot: string, relativeFile: string, content: string): void {
  execSync("git init -b main", { cwd: workspaceRoot, stdio: "pipe" });
  execSync('git config user.email "test@openagent.local"', { cwd: workspaceRoot, stdio: "pipe" });
  execSync('git config user.name "OpenAgent Test"', { cwd: workspaceRoot, stdio: "pipe" });
  mkdirSync(path.dirname(path.join(workspaceRoot, relativeFile)), { recursive: true });
  writeFileSync(path.join(workspaceRoot, relativeFile), content, "utf8");
  execSync("git add .", { cwd: workspaceRoot, stdio: "pipe" });
  execSync('git commit -m "seed"', { cwd: workspaceRoot, stdio: "pipe" });
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
    .run("sess-finalize", workspaceId, "agent", "2026-10-28T12:00:00.000Z");
  database
    .prepare(`INSERT INTO run(id, session_id, state, started_at) VALUES (?, ?, ?, ?)`)
    .run(runId, "sess-finalize", "running", "2026-10-28T12:01:00.000Z");
}

test("[SES-04] aplicar trabalho isolado copia alterações e remove worktree", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-apply";
    const runId = "run-apply";
    const isolatedWorkId = "work-apply";
    const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-canonical-apply-"));
    const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worktrees-apply-"));
    const relativePath = "src/feature.ts";
    const originalContent = "export const feature = 1;\n";
    const isolatedEdit = "export const feature = 42;\n";

    initGitRepo(canonicalRoot, relativePath, originalContent);
    const created = createIsolatedGitWork({
      workspaceRoot: canonicalRoot,
      isolatedWorkId,
      worktreesRoot,
    });
    writeFileSync(path.join(created.isolatedWorkspaceRoot, relativePath), isolatedEdit, "utf8");

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    try {
      seedRun(sqlite, workspaceId, runId);
      createStoredIsolatedWork(sqlite, {
        runId,
        isolatedWorkId: created.isolatedWorkId,
        canonicalRoot: created.canonicalWorkspaceRoot,
        isolatedRoot: created.isolatedWorkspaceRoot,
        gitBranch: created.gitBranch,
      });

      const outcome = finalizeIsolatedGitWork({
        decision: "apply",
        workspaceRoot: canonicalRoot,
        isolatedWorkspaceRoot: created.isolatedWorkspaceRoot,
      });
      assert.equal(outcome.decision, "apply");
      if (!("applied" in outcome) || !outcome.applied) {
        assert.fail("esperava apply bem-sucedido");
      }
      assert.deepEqual(outcome.relativePaths, [relativePath]);

      assert.equal(readFileSync(path.join(canonicalRoot, relativePath), "utf8"), isolatedEdit);
      assert.equal(existsSync(created.isolatedWorkspaceRoot), false);

      const stored = finalizeStoredIsolatedWork(sqlite, isolatedWorkId, "apply");
      assert.equal(stored.state, "applied");
    } finally {
      sqlite.close();
      db.close();
    }

    await rm(canonicalRoot, { recursive: true, force: true });
    await rm(worktreesRoot, { recursive: true, force: true });
  });
});

test("[SES-04] descartar trabalho isolado mantém workspace original intacto", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-discard";
    const runId = "run-discard";
    const isolatedWorkId = "work-discard";
    const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-canonical-discard-"));
    const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worktrees-discard-"));
    const relativePath = "lib.ts";
    const originalContent = "export const v = 1;\n";

    initGitRepo(canonicalRoot, relativePath, originalContent);
    const created = createIsolatedGitWork({
      workspaceRoot: canonicalRoot,
      isolatedWorkId,
      worktreesRoot,
    });
    writeFileSync(
      path.join(created.isolatedWorkspaceRoot, relativePath),
      "export const v = 99;\n",
      "utf8",
    );

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    try {
      seedRun(sqlite, workspaceId, runId);
      createStoredIsolatedWork(sqlite, {
        runId,
        isolatedWorkId: created.isolatedWorkId,
        canonicalRoot: created.canonicalWorkspaceRoot,
        isolatedRoot: created.isolatedWorkspaceRoot,
        gitBranch: created.gitBranch,
      });

      discardIsolatedGitWork({
        workspaceRoot: canonicalRoot,
        isolatedWorkspaceRoot: created.isolatedWorkspaceRoot,
      });
      assert.equal(readFileSync(path.join(canonicalRoot, relativePath), "utf8"), originalContent);
      assert.equal(existsSync(created.isolatedWorkspaceRoot), false);

      const stored = finalizeStoredIsolatedWork(sqlite, isolatedWorkId, "discard");
      assert.equal(stored.state, "discarded");
    } finally {
      sqlite.close();
      db.close();
    }

    await rm(canonicalRoot, { recursive: true, force: true });
    await rm(worktreesRoot, { recursive: true, force: true });
  });
});

test("[SES-04] aplicar com conflito ERR-01 não altera workspace nem remove worktree", async () => {
  const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-canonical-conflict-"));
  const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worktrees-conflict-"));
  const relativePath = "app.ts";
  const originalContent = "export const app = 1;\n";

  initGitRepo(canonicalRoot, relativePath, originalContent);
  const created = createIsolatedGitWork({
    workspaceRoot: canonicalRoot,
    isolatedWorkId: "work-conflict",
    worktreesRoot,
  });
  writeFileSync(
    path.join(created.isolatedWorkspaceRoot, relativePath),
    "export const app = 2;\n",
    "utf8",
  );
  writeFileSync(path.join(canonicalRoot, relativePath), "export const app = 9;\n", "utf8");

  const outcome = finalizeIsolatedGitWork({
    decision: "apply",
    workspaceRoot: canonicalRoot,
    isolatedWorkspaceRoot: created.isolatedWorkspaceRoot,
  });
  assert.equal(outcome.decision, "apply");
  if (!("conflict" in outcome) || !outcome.conflict) {
    assert.fail("esperava conflito ERR-01");
  }
  assert.equal(outcome.conflicts.length, 1);
  assert.equal(readFileSync(path.join(canonicalRoot, relativePath), "utf8"), "export const app = 9;\n");
  assert.equal(existsSync(created.isolatedWorkspaceRoot), true);

  discardIsolatedGitWork({
    workspaceRoot: canonicalRoot,
    isolatedWorkspaceRoot: created.isolatedWorkspaceRoot,
  });
  await rm(canonicalRoot, { recursive: true, force: true });
  await rm(worktreesRoot, { recursive: true, force: true });
});

test("[SES-04] finalizar storage inválido retorna INVALID_STATE sem efeito colateral", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-invalid";
    const runId = "run-invalid";
    const isolatedWorkId = "work-invalid";
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    try {
      seedRun(sqlite, workspaceId, runId);
      createStoredIsolatedWork(sqlite, {
        runId,
        isolatedWorkId,
        canonicalRoot: "/tmp/canonical",
        isolatedRoot: "/tmp/isolated",
        gitBranch: "openagent/isolated/work-invalid",
      });
      finalizeStoredIsolatedWork(sqlite, isolatedWorkId, "discard");

      assert.throws(
        () => finalizeStoredIsolatedWork(sqlite, isolatedWorkId, "apply"),
        (error: unknown) => {
          assert.ok(error instanceof ProtocolError);
          assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
          return true;
        },
      );

      const row = getStoredIsolatedWorkRecordById(sqlite, isolatedWorkId);
      assert.equal(row?.state, "discarded");
    } finally {
      sqlite.close();
      db.close();
    }
  });
});
