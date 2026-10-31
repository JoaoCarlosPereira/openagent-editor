import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { IsolatedWorktreeController } from "../../src/agents/isolated-worktree.js";

function initRepo(root: string, file: string, contents: string): void {
  execSync("git init -b main", { cwd: root, stdio: "pipe" });
  execSync('git config user.email "test@openagent.local"', { cwd: root, stdio: "pipe" });
  execSync('git config user.name "OpenAgent Test"', { cwd: root, stdio: "pipe" });
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents, "utf8");
  execSync("git add .", { cwd: root, stdio: "pipe" });
  execSync('git commit -m "seed"', { cwd: root, stdio: "pipe" });
}

test("[SES-04] UI cria worktree, preserva original até aplicar e então atualiza conteúdo", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "openagent-ui-worktree-"));
  const workspace = path.join(base, "workspace");
  const worktrees = path.join(base, "worktrees");
  const file = "src/value.ts";
  const original = "export const value = 1;\n";
  const changed = "export const value = 2;\n";
  mkdirSync(workspace);
  initRepo(workspace, file, original);
  try {
    const controller = new IsolatedWorktreeController(workspace, worktrees);
    const created = await controller.create("apply-case");
    assert.equal(created.accessible.phase, "active");
    assert.equal(created.accessible.isolatedWorkId, "apply-case");
    assert.match(created.html, /data-testid="isolated-work-apply"/);
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
    const isolatedRoot = created.accessible.isolatedWorkspaceRoot;
    assert.ok(isolatedRoot);
    writeFileSync(path.join(isolatedRoot, file), changed, "utf8");
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
    const applied = await controller.apply();
    assert.equal(applied.accessible.phase, "applied");
    assert.deepEqual(applied.accessible.changedPaths, [file]);
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), changed);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("[SES-04] descartar mantém original intacto e valida erro estável sem efeitos colaterais", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "openagent-ui-worktree-discard-"));
  const workspace = path.join(base, "workspace");
  const worktrees = path.join(base, "worktrees");
  const file = "value.ts";
  const original = "original\n";
  mkdirSync(workspace);
  initRepo(workspace, file, original);
  try {
    const controller = new IsolatedWorktreeController(workspace, worktrees);
    const before = controller.snapshot;
    await assert.rejects(() => controller.create("../invalid"), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.equal(controller.snapshot.accessible.phase, before.accessible.phase);
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
    const created = await controller.create("discard-case");
    const isolatedRoot = created.accessible.isolatedWorkspaceRoot;
    assert.ok(isolatedRoot);
    writeFileSync(path.join(isolatedRoot, file), "discarded change\n", "utf8");
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
    const discarded = await controller.discard();
    assert.equal(discarded.accessible.phase, "discarded");
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
    await assert.rejects(() => controller.apply(), (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    });
    assert.equal(readFileSync(path.join(workspace, file), "utf8"), original);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
