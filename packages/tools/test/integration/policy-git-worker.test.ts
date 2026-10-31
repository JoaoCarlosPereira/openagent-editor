import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  AGENT_MODE_ASK_BLOCKED_MESSAGE,
  assertCapabilityAllowedForAgentMode,
  assertRunToolMayExecute,
  RunToolPermissionFlow,
} from "@openagent/policy";

import {
  executePolicyGitDiffInWorker,
  executePolicyGitStatusInWorker,
  formatAgentGitDiffToolResult,
  formatAgentGitStatusToolResult,
  preparePolicyGitDiff,
  preparePolicyGitStatus,
  type PolicyGitToolContext,
} from "../../src/index.js";

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

function makeGitFixtureWorkspace(): { root: string; trackedPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-git-tools-"));
  const trackedPath = "tracked.txt";
  writeFileSync(path.join(root, trackedPath), "linha inicial\n", "utf8");
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.email", "agt03@test.local"]);
  runGit(root, ["config", "user.name", "AGT03 Test"]);
  runGit(root, ["add", trackedPath]);
  runGit(root, ["commit", "-m", "inicial", "-q"]);
  writeFileSync(path.join(root, trackedPath), "linha inicial\nlinha AGT03_GIT_MARKER\n", "utf8");
  return { root, trackedPath };
}

function agentContext(workspaceRoot: string): PolicyGitToolContext {
  return {
    workspaceRoot,
    agentMode: "agent",
    executionMode: "standard",
  };
}

test("[AGT-03] modo Agent consulta git status e diff via worker com saída capturada", async () => {
  const { root, trackedPath } = makeGitFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root);

  const statusPrepared = preparePolicyGitStatus(flow, ctx, {
    runId: "run-agt03-git",
    sessionId: "sess-agt03-git",
    requestId: "perm-git-status",
  });
  assert.equal(statusPrepared.permission.phase, "pending");
  if (statusPrepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(statusPrepared.permission.prompt.action, "Consultar status Git");

  const statusAllowed = flow.decide(statusPrepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(statusAllowed.gate);

  const statusRaw = await executePolicyGitStatusInWorker(root);
  const statusTool = formatAgentGitStatusToolResult(statusRaw);
  assert.equal(statusTool.capability, "git.status");
  assert.ok(statusTool.stdout.includes(trackedPath));
  assert.ok(statusTool.stdout.includes("AGT03_GIT_MARKER") || statusTool.stdout.includes("M "));

  const diffPrepared = preparePolicyGitDiff(flow, ctx, {
    runId: "run-agt03-git",
    sessionId: "sess-agt03-git",
    requestId: "perm-git-diff",
    relativePath: trackedPath,
  });
  assert.equal(diffPrepared.permission.phase, "pending");
  if (diffPrepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(diffPrepared.permission.prompt.action, "Consultar diff Git");

  const diffAllowed = flow.decide(diffPrepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(diffAllowed.gate);

  const diffRaw = await executePolicyGitDiffInWorker(root, trackedPath);
  const diffTool = formatAgentGitDiffToolResult(diffRaw);
  assert.equal(diffTool.capability, "git.diff");
  assert.equal(diffTool.relativePath, trackedPath);
  assert.ok(diffTool.stdout.includes("AGT03_GIT_MARKER"));
});

test("[AGT-03] git status permitido em Somente leitura (capability não mutável)", async () => {
  const { root } = makeGitFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx: PolicyGitToolContext = {
    workspaceRoot: root,
    agentMode: "agent",
    executionMode: "read_only",
  };

  const prepared = preparePolicyGitStatus(flow, ctx, {
    runId: "run-ro-git",
    sessionId: "sess-ro-git",
    requestId: "perm-ro-git-status",
  });
  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(allowed.gate);
  const statusRaw = await executePolicyGitStatusInWorker(root);
  assert.equal(statusRaw.exitCode, 0);
});

test("[AGT-03] caminho de erro: workspace sem Git ou diff inválido retorna INVALID_STATE", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-git-norepo-"));
  writeFileSync(path.join(root, "plain.txt"), "sem git\n", "utf8");
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root);

  const prepared = preparePolicyGitStatus(flow, ctx, {
    runId: "run-invalid-git",
    sessionId: "sess-invalid-git",
    requestId: "perm-invalid-git",
  });
  if (prepared.permission.phase !== "pending") {
    return;
  }
  flow.decide(prepared.permission.request.requestId, "allow", "once");

  await assert.rejects(
    () => executePolicyGitStatusInWorker(root),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () =>
      preparePolicyGitDiff(flow, ctx, {
        runId: "run-invalid-git",
        sessionId: "sess-invalid-git",
        requestId: "perm-invalid-diff-path",
        relativePath: "/etc/passwd",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => assertCapabilityAllowedForAgentMode("ask", "git.status"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
      return true;
    },
  );
});
