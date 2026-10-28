import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  assertRunToolMayExecute,
  RunToolPermissionFlow,
} from "@openagent/policy";

import {
  applyWorkspaceFileWrite,
  executeAgentFileWriteBatch,
  fileWriteConflictProtocolError,
  preparePolicyFileWrite,
  sha256HexUtf8,
  snapshotWorkspaceFileForWrite,
  summarizeAgentFileWriteBatch,
  type PolicyFileToolContext,
} from "../../src/index.js";

function makeFixtureWorkspace(): { root: string; fileA: string; fileB: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-file-write-"));
  const fileA = "src/a.ts";
  const fileB = "src/b.ts";
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, fileA), "const a = 1;\n", "utf8");
  writeFileSync(path.join(root, fileB), "const b = 1;\n", "utf8");
  return { root, fileA, fileB };
}

function agentContext(workspaceRoot: string): PolicyFileToolContext {
  return {
    workspaceRoot,
    agentMode: "agent",
    executionMode: "standard",
  };
}

test("[ERR-01] hash esperado divergente impede escrita e expõe as duas versões", () => {
  const { root, fileA } = makeFixtureWorkspace();
  const snapshot = snapshotWorkspaceFileForWrite(root, fileA);
  writeFileSync(path.join(root, fileA), "const a = 2;\n", "utf8");

  const result = applyWorkspaceFileWrite(root, {
    relativePath: fileA,
    expectedContentHashHex: snapshot.contentHashHex,
    newContent: "const a = 99;\n",
  });

  assert.equal(result.status, "conflict");
  if (result.status !== "conflict") {
    return;
  }
  assert.equal(result.currentContent, "const a = 2;\n");
  assert.equal(result.proposedContent, "const a = 99;\n");
  assert.notEqual(result.currentContent, result.proposedContent);

  const protocolError = fileWriteConflictProtocolError(result);
  assert.equal(protocolError.code, PROTOCOL_ERROR_CODES.CONFLICT);
  assert.ok(protocolError.details.some((detail) => detail.includes("currentContent")));
  assert.ok(protocolError.details.some((detail) => detail.includes("proposedContent")));
});

test("[AGT-03] modo Agent aplica múltiplas escritas e agrega diff por ferramenta", () => {
  const { root, fileA, fileB } = makeFixtureWorkspace();
  const snapA = snapshotWorkspaceFileForWrite(root, fileA);
  const snapB = snapshotWorkspaceFileForWrite(root, fileB);

  const flow = new RunToolPermissionFlow();
  const ctx = agentContext(root);

  for (const [relativePath, requestId] of [
    [fileA, "perm-write-a"],
    [fileB, "perm-write-b"],
  ] as const) {
    const prepared = preparePolicyFileWrite(flow, ctx, {
      runId: "run-agt03",
      sessionId: "sess-agt03",
      requestId,
      relativePath,
    });
    assert.equal(prepared.permission.phase, "pending");
    if (prepared.permission.phase !== "pending") {
      return;
    }
    const allowed = flow.decide(prepared.permission.request.requestId, "allow", "once");
    assertRunToolMayExecute(allowed.gate);
  }

  const batch = executeAgentFileWriteBatch(root, "agent", [
    {
      relativePath: fileA,
      expectedContentHashHex: snapA.contentHashHex,
      newContent: "const a = 10;\n",
    },
    {
      relativePath: fileB,
      expectedContentHashHex: snapB.contentHashHex,
      newContent: "const b = 20;\n",
    },
  ]);

  const summary = summarizeAgentFileWriteBatch(batch);
  assert.equal(summary.appliedCount, 2);
  assert.equal(summary.conflictCount, 0);
  assert.ok(batch.groupedDiff.includes(fileA));
  assert.ok(batch.groupedDiff.includes(fileB));
  assert.equal(batch.results.length, 2);
  assert.ok(batch.results.every((result) => result.status === "applied"));
  assert.equal(sha256HexUtf8("const a = 10;\n"), (batch.results[0] as { newContentHashHex: string }).newContentHashHex);
});

test("[ERR-01] caminho de erro: hash inválido retorna INVALID_STATE sem gravar", () => {
  const { root, fileA } = makeFixtureWorkspace();
  assert.throws(
    () =>
      applyWorkspaceFileWrite(root, {
        relativePath: fileA,
        expectedContentHashHex: "hash-curto",
        newContent: "x",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
