import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  EMBEDDING_VECTOR_REF_PREFIX,
  loadRedistributableLocalEmbeddingModel,
  reindexContextFileOnSave,
  searchPersistedChunkEmbeddings,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("[CTX-02] vetores locais por chunk: reindexação ao salvar encontra texto novo sem reconstruir índice inteiro", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-vector-"));
  const srcDir = path.join(root, "src");
  mkdirSync(srcDir, { recursive: true });

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

    const vectorRows = database
      .prepare(
        `SELECT vector_ref AS vectorRef FROM context_chunk_embedding WHERE path = ? ORDER BY chunk_index`,
      )
      .all(pathA) as Array<{ vectorRef: string }>;
    assert.ok(vectorRows.length > 0);
    for (const row of vectorRows) {
      assert.ok(row.vectorRef.startsWith(EMBEDDING_VECTOR_REF_PREFIX));
    }

    assert.equal(searchPersistedChunkEmbeddings(database, model, "gamma").length, 1);

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

    const deltaHits = searchPersistedChunkEmbeddings(database, model, "delta");
    assert.equal(deltaHits.length, 1);
    assert.equal(deltaHits[0]?.path, pathA);

    assert.equal(searchPersistedChunkEmbeddings(database, model, "gamma").length, 1);
  } finally {
    database.close();
  }
});

test("[CTX-02] caminho de erro retorna INVALID_STATE sem efeito colateral", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-vector-err-"));
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
      () => searchPersistedChunkEmbeddings(database, model, "   "),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(searchPersistedChunkEmbeddings(database, model, "keep").length, 1);
  } finally {
    database.close();
  }
});
