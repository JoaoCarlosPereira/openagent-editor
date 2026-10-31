import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  executeContextAttachRpc,
  executeContextIndexRpc,
  executeContextSearchRpc,
  indexContextFile,
  resolveContextExclusionRuleset,
  searchContextIndex,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

function fixtureWorkspace(): { root: string; publicPath: string; secretPath: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-excl-"));
  writeFileSync(path.join(root, ".gitignore"), "secrets/\n");
  mkdirSync(path.join(root, "secrets"), { recursive: true });
  const publicPath = "src/open.ts";
  const secretPath = "secrets/token.txt";
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, publicPath), "export const visible = true;\n");
  writeFileSync(path.join(root, secretPath), "super-secret-token\n");
  return { root, publicPath, secretPath };
}

test("[CTX-03] indexação e busca omitem caminhos excluídos pelo .gitignore", () => {
  const { root, publicPath, secretPath } = fixtureWorkspace();
  const ruleset = resolveContextExclusionRuleset({ workspaceRoot: root });
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: publicPath,
      content: "export const visible = true;\n",
      exclusionRuleset: ruleset,
    });
    indexContextFile(database, {
      path: secretPath,
      content: "super-secret-token\n",
      exclusionRuleset: ruleset,
    });

    const publicHits = searchContextIndex(database, {
      query: "visible",
      exclusionRuleset: ruleset,
    });
    assert.equal(publicHits.hits.length, 1);
    assert.equal(publicHits.hits[0]?.path, publicPath);

    const secretHits = searchContextIndex(database, {
      query: "super-secret",
      exclusionRuleset: ruleset,
    });
    assert.equal(secretHits.hits.length, 0);
  } finally {
    database.close();
  }
});

test("[CTX-03] executeContextIndexRpc não indexa paths excluídos", () => {
  const { root, publicPath, secretPath } = fixtureWorkspace();
  writeFileSync(path.join(root, secretPath), "super-secret-token\nlinha extra\n");

  const database = openIndexDatabase();
  try {
    const rpc = executeContextIndexRpc(
      database,
      { paths: [publicPath, secretPath] },
      { workspaceRoot: root },
    );
    assert.equal(rpc.indexed, 1);

    const hits = executeContextSearchRpc(
      database,
      { query: "extra" },
      { workspaceRoot: root },
    );
    assert.equal(hits.hits.length, 0);
  } finally {
    database.close();
  }
});

test("[CTX-03] executeContextAttachRpc omite anexos em caminhos excluídos", () => {
  const { root, publicPath, secretPath } = fixtureWorkspace();

  const result = executeContextAttachRpc(
    {
      attachments: [
        {
          id: "pub",
          kind: "file",
          path: path.join(root, publicPath),
          previewText: "export const visible = true;",
        },
        {
          id: "sec",
          kind: "file",
          path: path.join(root, secretPath),
          previewText: "super-secret-token",
        },
      ],
    },
    { workspaceRoot: root },
  );

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.id, "pub");
});

test("[CTX-03] exclusions_json inválido retorna INVALID_STATE sem efeito colateral", () => {
  const { root, publicPath } = fixtureWorkspace();
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: publicPath,
      content: "export const visible = true;\n",
    });

    assert.throws(
      () =>
        executeContextIndexRpc(
          database,
          { paths: [publicPath] },
          { workspaceRoot: root, workspaceExclusionPatterns: { bad: true } },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () =>
        executeContextSearchRpc(
          database,
          { query: "visible" },
          { workspaceRoot: root, workspaceExclusionPatterns: { bad: true } },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(searchContextIndex(database, { query: "visible" }).hits.length, 1);
  } finally {
    database.close();
  }
});
