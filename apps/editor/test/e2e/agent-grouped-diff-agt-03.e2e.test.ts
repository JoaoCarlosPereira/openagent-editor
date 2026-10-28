import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HARNESS_EVENT_SCHEMA_VERSION, ProtocolError } from "@openagent/protocol";

import { AgentRunReviewController } from "../../src/review/agent-run-review.js";

const RUN_ID = "run-agt-03-e2e";

function harnessEvent(sequence: number, type: string, payloadRef: string) {
  return {
    sequence,
    runId: RUN_ID,
    type,
    schemaVersion: HARNESS_EVENT_SCHEMA_VERSION,
    payloadRef,
    timestamp: 1_729_000_000_000 + sequence,
  };
}

describe("AGT-03 e2e — diff agrupado e resultado por ferramenta", () => {
  it("mostra diff agrupado de multiarquivo e resultado de shell autorizado", () => {
    const review = new AgentRunReviewController(RUN_ID);
    const fileA = "src/a.ts";
    const fileB = "src/b.ts";
    const groupedDiff = [`--- ${fileA}`, `+++ ${fileA}`, `--- ${fileB}`, `+++ ${fileB}`].join("\n");

    review.push({
      event: harnessEvent(1, "tool.result", "sha256:write-batch"),
      payload: {
        runId: RUN_ID,
        invocation: {
          id: "inv-write-1",
          tool: "file.write",
          target: "/tmp/workspace",
          capability: "file.write",
          state: "completed",
          resultRef: "sha256:write-result",
        },
      },
      resolvedToolResult: {
        kind: "tool_result",
        result: { appliedCount: 2, conflictCount: 0, groupedDiffPreview: groupedDiff.slice(0, 50) },
      },
    });

    review.push({
      event: harnessEvent(2, "tool.result", "sha256:shell"),
      payload: {
        runId: RUN_ID,
        invocation: {
          id: "inv-shell-1",
          tool: "shell.exec",
          target: "npm test",
          capability: "shell.exec",
          state: "completed",
          resultRef: "sha256:shell-result",
        },
      },
      resolvedToolResult: {
        kind: "tool_result",
        result: {
          capability: "shell.exec",
          tool: "shell.exec",
          command: "npm test",
          exitCode: 0,
          stdout: "AGT03_LOOP_SHELL ok",
          stderr: "",
          timedOut: false,
        },
      },
    });

    const view = review.push({
      event: harnessEvent(3, "diff.grouped", "sha256:grouped"),
      payload: {
        runId: RUN_ID,
        groupedDiff,
        fileCount: 2,
      },
    });

    assert.match(view.html, /data-testid="agent-run-review"/);
    assert.match(view.html, /data-testid="agent-grouped-diff"/);
    assert.match(view.html, /data-testid="agent-grouped-diff-body"/);
    assert.match(view.html, new RegExp(escapeRegExp(fileA)));
    assert.match(view.html, new RegExp(escapeRegExp(fileB)));
    assert.equal(view.accessible.fileCount, 2);
    assert.equal(view.accessible.toolResults.length, 2);

    const shellRow = view.accessible.toolResults.find((row) => row.tool === "shell.exec");
    assert.ok(shellRow);
    assert.match(shellRow.detail, /AGT03_LOOP_SHELL/);
    assert.equal(shellRow.summary, "exit 0");

    const writeRow = view.accessible.toolResults.find((row) => row.tool === "file.write");
    assert.ok(writeRow);
    assert.equal(writeRow.summary, "2 arquivo(s)");
  });

  it("caminho de erro: evento inválido retorna INVALID_STATE sem alterar o painel", () => {
    const review = new AgentRunReviewController(RUN_ID);
    review.push({
      event: harnessEvent(1, "tool.result", "sha256:one"),
      payload: {
        runId: RUN_ID,
        invocation: {
          id: "inv-1",
          tool: "file.write",
          target: "/tmp",
          capability: "file.write",
          state: "completed",
        },
      },
    });
    const before = review.snapshot.html;

    assert.throws(
      () =>
        review.push({
          event: { sequence: 0, runId: RUN_ID, type: "tool.result" },
          payload: {},
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );
    assert.equal(review.snapshot.html, before);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
