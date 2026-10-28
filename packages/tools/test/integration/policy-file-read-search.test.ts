import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  executePolicyFileRead,
  executePolicyFileSearch,
  preparePolicyFileRead,
  preparePolicyFileSearch,
  type PolicyFileToolContext,
} from "../../src/index.js";

function makeFixtureWorkspace(): { root: string; samplePath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-file-tools-"));
  const samplePath = "src/sample.ts";
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, samplePath),
    "export const AGT01_MARKER = 'find-me-in-ask';\n",
    "utf8",
  );
  writeFileSync(path.join(root, "README.md"), "# fixture\n", "utf8");
  return { root, samplePath };
}

function askContext(workspaceRoot: string): PolicyFileToolContext {
  return {
    workspaceRoot,
    agentMode: "ask",
    executionMode: "standard",
  };
}

test("[AGT-01] modo Ask permite leitura e busca após aceite explícito", () => {
  const { root, samplePath } = makeFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = askContext(root);

  const readPrepared = preparePolicyFileRead(flow, ctx, {
    runId: "run-agt01-read",
    sessionId: "sess-agt01",
    requestId: "perm-read-agt01",
    relativePath: samplePath,
  });
  assert.equal(readPrepared.permission.phase, "pending");
  if (readPrepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(readPrepared.permission.prompt.action, "Ler arquivo");
  assert.equal(readPrepared.permission.prompt.target, samplePath);
  const pendingRead = readPrepared.permission;
  assert.equal(pendingRead.phase, "pending");
  if (pendingRead.phase !== "pending") {
    return;
  }
  assert.throws(() => assertRunToolMayExecute(pendingRead.gate), (error: unknown) => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, PROTOCOL_ERROR_CODES.PERMISSION_DENIED);
    return true;
  });

  const readAllowed = flow.decide(pendingRead.request.requestId, "allow", "once");
  assertRunToolMayExecute(readAllowed.gate);
  const readResult = executePolicyFileRead(root, samplePath);
  assert.ok(readResult.content.includes("AGT01_MARKER"));

  const searchPrepared = preparePolicyFileSearch(flow, ctx, {
    runId: "run-agt01-search",
    sessionId: "sess-agt01",
    requestId: "perm-search-agt01",
    query: "find-me-in-ask",
  });
  assert.equal(searchPrepared.permission.phase, "pending");
  if (searchPrepared.permission.phase !== "pending") {
    return;
  }
  assert.equal(searchPrepared.permission.prompt.action, "Buscar em arquivos");
  const searchAllowed = flow.decide(searchPrepared.permission.request.requestId, "allow", "once");
  assertRunToolMayExecute(searchAllowed.gate);
  const searchResult = executePolicyFileSearch(root, "find-me-in-ask");
  assert.ok(searchResult.hits.some((hit) => hit.path === samplePath));

  assert.throws(
    () => assertCapabilityAllowedForAgentMode("ask", "file.write"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.message, AGENT_MODE_ASK_BLOCKED_MESSAGE);
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

test("[AGT-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const { root } = makeFixtureWorkspace();
  const flow = new RunToolPermissionFlow();
  const ctx = askContext(root);

  assert.throws(
    () =>
      preparePolicyFileRead(flow, ctx, {
        runId: "run-invalid",
        sessionId: "sess-invalid",
        requestId: "perm-invalid-read",
        relativePath: "",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => executePolicyFileSearch(root, "   "),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => executePolicyFileRead(root, path.join("..", "outside.txt")),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
      return true;
    },
  );
});
