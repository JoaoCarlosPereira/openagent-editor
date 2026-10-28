import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  executeContextSearchRpc,
  loadRedistributableLocalEmbeddingModel,
  reindexContextFileOnSave,
  resolveContextExclusionRuleset,
  searchContextIndex,
  searchHybridContextIndex,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("[CTX-02] retrieval híbrido encontra texto novo após salvar sem reconstruir índice inteiro", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-hybrid-"));
  mkdirSync(path.join(root, "src"), { recursive: true });

  const pathA = "src/a.ts";
  const pathB = "src/b.ts";
  writeFileSync(path.join(root, pathA), "export const alpha = 1;\nexport const beta = 2;\n");
  writeFileSync(path.join(root, pathB), "export const gamma = 3;\n");

  const database = openIndexDatabase();
  try {
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: pathA,
      embeddingModel: model,
    });
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: pathB,
      embeddingModel: model,
    });

    assert.equal(
      searchHybridContextIndex(database, {
        query: "gamma",
        embeddingModel: model,
      }).hits.length,
      1,
    );

    writeFileSync(
      path.join(root, pathA),
      "export const alpha = 1;\nexport const beta = 2;\nexport const delta = 4;\n",
    );
    const saveResult = reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: pathA,
      embeddingModel: model,
    });
    assert.equal(saveResult.indexed, true);

    const deltaHits = searchContextIndex(database, {
      query: "delta",
      embeddingModel: model,
    });
    assert.equal(deltaHits.hits.length, 1);
    assert.equal(deltaHits.hits[0]?.path, pathA);

    assert.equal(
      searchHybridContextIndex(database, {
        query: "gamma",
        embeddingModel: model,
      }).hits.length,
      1,
    );
  } finally {
    database.close();
  }
});

test("[CTX-03] retrieval híbrido omite caminhos excluídos na busca do agente", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-hybrid-excl-"));
  writeFileSync(path.join(root, ".gitignore"), "secrets/\n");
  mkdirSync(path.join(root, "secrets"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });

  const publicPath = "src/open.ts";
  const secretPath = "secrets/token.txt";
  writeFileSync(path.join(root, publicPath), "export const visible = true;\n");
  writeFileSync(path.join(root, secretPath), "super-secret-token\n");

  const ruleset = resolveContextExclusionRuleset({ workspaceRoot: root });
  const database = openIndexDatabase();
  try {
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: publicPath,
      exclusionRuleset: ruleset,
      embeddingModel: model,
    });
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: secretPath,
      exclusionRuleset: ruleset,
      embeddingModel: model,
    });

    const publicHits = searchHybridContextIndex(database, {
      query: "visible",
      exclusionRuleset: ruleset,
      embeddingModel: model,
    });
    assert.equal(publicHits.hits.length, 1);
    assert.equal(publicHits.hits[0]?.path, publicPath);

    const secretHits = searchHybridContextIndex(database, {
      query: "super-secret",
      exclusionRuleset: ruleset,
      embeddingModel: model,
    });
    assert.equal(secretHits.hits.length, 0);

    const rpcHits = executeContextSearchRpc(
      database,
      { query: "super-secret" },
      { workspaceRoot: root, embeddingModel: model },
    );
    assert.equal(rpcHits.hits.length, 0);
  } finally {
    database.close();
  }
});

test("[CTX-02] caminho de erro retorna INVALID_STATE sem efeito colateral", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-hybrid-err-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/keep.ts"), "export const keep = true;\n");

  const database = openIndexDatabase();
  try {
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: "src/keep.ts",
      embeddingModel: model,
    });

    assert.throws(
      () =>
        searchHybridContextIndex(database, {
          query: "   ",
          embeddingModel: model,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(
      searchHybridContextIndex(database, {
        query: "keep",
        embeddingModel: model,
      }).hits.length,
      1,
    );
  } finally {
    database.close();
  }
});
