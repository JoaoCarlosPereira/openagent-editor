import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  createIncrementalChunkEmbeddingIndex,
  loadRedistributableLocalEmbeddingModel,
  reindexPathEmbeddingsOnSave,
  searchIncrementalChunkEmbeddings,
} from "../../src/embeddings/index.js";

test("[CTX-02] modelo redistribuível: reindexação ao salvar encontra texto novo sem reconstruir índice inteiro", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  assert.equal(model.manifest.license.redistributable, true);
  assert.equal(model.manifest.license.spdx, "Apache-2.0");

  const index = createIncrementalChunkEmbeddingIndex(model);

  reindexPathEmbeddingsOnSave(index, {
    path: "src/a.ts",
    content: "export const alpha = 1;\nexport const beta = 2;\n",
  });
  reindexPathEmbeddingsOnSave(index, {
    path: "src/b.ts",
    content: "export const gamma = 3;\n",
  });

  assert.equal(searchIncrementalChunkEmbeddings(index, "gamma").length, 1);

  reindexPathEmbeddingsOnSave(index, {
    path: "src/a.ts",
    content: "export const alpha = 1;\nexport const beta = 2;\nexport const delta = 4;\n",
  });

  const deltaHits = searchIncrementalChunkEmbeddings(index, "delta");
  assert.equal(deltaHits.length, 1);
  assert.equal(deltaHits[0]?.path, "src/a.ts");

  assert.equal(searchIncrementalChunkEmbeddings(index, "gamma").length, 1);
});

test("[CTX-02] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const model = await loadRedistributableLocalEmbeddingModel();
  const index = createIncrementalChunkEmbeddingIndex(model);

  reindexPathEmbeddingsOnSave(index, {
    path: "src/keep.ts",
    content: "export const keep = true;\n",
  });

  assert.throws(
    () =>
      reindexPathEmbeddingsOnSave(index, {
        path: "   ",
        content: "noop",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () => searchIncrementalChunkEmbeddings(index, "   "),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.equal(searchIncrementalChunkEmbeddings(index, "keep").length, 1);
});
