import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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
  getStoredIsolatedWorkById,
  openWorkspaceDatabase,
} from "@openagent/storage";
import {
  createIsolatedGitWork,
  dispatchInIsolatedWorker,
  removeIsolatedGitWork,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(os.tmpdir(), "openagent-isolated-work-"));
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
    .run("sess-isolated", workspaceId, "agent", "2026-10-28T12:00:00.000Z");
  database
    .prepare(`INSERT INTO run(id, session_id, state, started_at) VALUES (?, ?, ?, ?)`)
    .run(runId, "sess-isolated", "running", "2026-10-28T12:01:00.000Z");
}

test("[SES-04] trabalho isolado usa git worktree e preserva arquivos do workspace original", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-isolated-ok";
    const runId = "run-isolated-1";
    const isolatedWorkId = "work-1";
    const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-canonical-"));
    const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worktrees-"));
    const relativePath = "src/feature.ts";
    const originalContent = "export const feature = 1;\n";

    initGitRepo(canonicalRoot, relativePath, originalContent);

    const created = createIsolatedGitWork({
      workspaceRoot: canonicalRoot,
      isolatedWorkId,
      worktreesRoot,
    });

    assert.equal(created.canonicalWorkspaceRoot, path.resolve(canonicalRoot));
    assert.equal(created.isolatedWorkspaceRoot, path.join(worktreesRoot, isolatedWorkId));
    assert.match(created.gitBranch, /^openagent\/isolated\//);

    const isolatedEdit = "export const feature = 999;\n";
    writeFileSync(path.join(created.isolatedWorkspaceRoot, relativePath), isolatedEdit, "utf8");

    assert.equal(
      readFileSync(path.join(canonicalRoot, relativePath), "utf8"),
      originalContent,
      "workspace original deve permanecer intacto",
    );

    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sqlite = new DatabaseSync(db.databasePath);
    sqlite.exec("PRAGMA foreign_keys = ON");
    try {
      seedRun(sqlite, workspaceId, runId);
      const stored = createStoredIsolatedWork(sqlite, {
        runId,
        isolatedWorkId: created.isolatedWorkId,
        canonicalRoot: created.canonicalWorkspaceRoot,
        isolatedRoot: created.isolatedWorkspaceRoot,
        gitBranch: created.gitBranch,
      });
      assert.equal(stored.state, "active");
      const loaded = getStoredIsolatedWorkById(sqlite, isolatedWorkId);
      assert.ok(loaded);
      assert.equal(loaded?.isolatedRoot, created.isolatedWorkspaceRoot);
    } finally {
      sqlite.close();
      db.close();
    }

    removeIsolatedGitWork({
      workspaceRoot: canonicalRoot,
      isolatedWorkspaceRoot: created.isolatedWorkspaceRoot,
    });
    await rm(canonicalRoot, { recursive: true, force: true });
    await rm(worktreesRoot, { recursive: true, force: true });
  });
});

test("[SES-04] entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-canonical-invalid-"));
  const nonGitRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-non-git-"));
  const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worktrees-invalid-"));
  initGitRepo(canonicalRoot, "readme.md", "# ok\n");

  assert.throws(
    () =>
      createIsolatedGitWork({
        workspaceRoot: canonicalRoot,
        isolatedWorkId: "",
        worktreesRoot,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () =>
      createIsolatedGitWork({
        workspaceRoot: nonGitRoot,
        isolatedWorkId: "ok-id",
        worktreesRoot,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await rm(canonicalRoot, { recursive: true, force: true });
  await rm(nonGitRoot, { recursive: true, force: true });
  await rm(worktreesRoot, { recursive: true, force: true });
});

test("[SES-04] worker gitWorktreeCreate registra worktree via Git CLI", async () => {
  const canonicalRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worker-wt-"));
  const worktreesRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-worker-wts-"));
  initGitRepo(canonicalRoot, "app.ts", "export {};\n");
  const worktreePath = path.join(worktreesRoot, "worker-case");

  const output = (await dispatchInIsolatedWorker(
    "gitWorktreeCreate",
    {
      workspaceRoot: canonicalRoot,
      worktreePath,
      branchName: "openagent/isolated/worker-case",
    },
    ["gitWorktreeCreate"],
  )) as { worktreePath: string; branchName: string };

  assert.equal(output.worktreePath, path.resolve(worktreePath));
  assert.equal(output.branchName, "openagent/isolated/worker-case");

  removeIsolatedGitWork({ workspaceRoot: canonicalRoot, isolatedWorkspaceRoot: worktreePath });
  await rm(canonicalRoot, { recursive: true, force: true });
  await rm(worktreesRoot, { recursive: true, force: true });
});
