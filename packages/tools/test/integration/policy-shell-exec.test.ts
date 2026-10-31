import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  AGENT_MODE_ASK_BLOCKED_MESSAGE,
  assertCapabilityAllowedForAgentMode,
  assertRunToolMayExecute,
  EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE,
  RunToolPermissionFlow,
} from "@openagent/policy";

import {
  executePolicyShellExec,
  formatAgentShellToolResult,
  preparePolicyShellExec,
  type PolicyShellToolContext,
} from "../../src/index.js";

function makeFixtureWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-shell-tools-"));
  writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}\n', "utf8");
  return root;
}

function agentContext(workspaceRoot: string, executionMode: "standard" | "read_only" = "standard"): PolicyShellToolContext {
  return {
    workspaceRoot,
    agentMode: "agent",
    executionMode,
  };
}

test("[AGT-03] modo Agent executa comando autorizado com saída capturada", () => {
  const root = makeFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root);
  const command = process.platform === "win32" ? "echo AGT03_SHELL_MARKER" : "echo AGT03_SHELL_MARKER";

  const prepared = preparePolicyShellExec(flow, ctx, {
    runId: "run-agt03-shell",
    sessionId: "sess-agt03",
    requestId: "perm-shell-agt03",
    command,
  });
  assert.equal(prepared.permission.phase, "pending");
  if (prepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(prepared.permission.prompt.action, "Executar comando");
  assert.equal(prepared.permission.prompt.target, command);

  const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(allowed.gate);

  const execResult = executePolicyShellExec(root, command);
  assert.ok(execResult.stdout.includes("AGT03_SHELL_MARKER"));
  const toolResult = formatAgentShellToolResult(execResult);
  assert.equal(toolResult.capability, "shell.exec");
  assert.equal(toolResult.tool, "shell.exec");
  assert.ok(toolResult.stdout.includes("AGT03_SHELL_MARKER"));
});

test("[PER-03] Somente leitura bloqueia shell antes do pedido de permissão", () => {
  const root = makeFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root, "read_only");

  assert.throws(
    () =>
      preparePolicyShellExec(flow, ctx, {
        runId: "run-per03-shell",
        sessionId: "sess-per03",
        requestId: "perm-ro-shell",
        command: "echo blocked",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
      assert.ok(
        error.message.includes(EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE) ||
          error.details.some((detail) => detail.includes(EXECUTION_MODE_READ_ONLY_BLOCKED_MESSAGE)),
      );
      return true;
    },
  );
});

test("[AGT-03] caminho de erro: comando inválido retorna INVALID_STATE sem efeito colateral", () => {
  const root = makeFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root);

  assert.throws(
    () =>
      preparePolicyShellExec(flow, ctx, {
        runId: "run-invalid-shell",
        sessionId: "sess-invalid",
        requestId: "perm-invalid-shell",
        command: "   ",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => executePolicyShellExec(root, ""),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => assertCapabilityAllowedForAgentMode("ask", "shell.exec"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
      return true;
    },
  );
});
