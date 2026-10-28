import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  hashContextFileContent,
  indexContextFile,
  searchContextIndex,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("[CTX-02] indexação incremental encontra texto novo sem reconstruir índice inteiro", () => {
  const database = openIndexDatabase();
  try {
    const pathA = "src/a.ts";
    const pathB = "src/b.ts";

    indexContextFile(database, {
      path: pathA,
      content: "export const alpha = 1;\nexport const beta = 2;\n",
    });
    indexContextFile(database, {
      path: pathB,
      content: "export const gamma = 3;\n",
    });

    const beforeSave = searchContextIndex(database, { query: "gamma" });
    assert.equal(beforeSave.hits.length, 1);
    assert.equal(beforeSave.hits[0]?.path, pathB);

    const updatedContent =
      "export const alpha = 1;\nexport const beta = 2;\nexport const delta = 4;\n";
    indexContextFile(database, {
      path: pathA,
      content: updatedContent,
      contentHash: hashContextFileContent(updatedContent),
    });

    const afterSave = searchContextIndex(database, { query: "delta" });
    assert.equal(afterSave.hits.length, 1);
    assert.equal(afterSave.hits[0]?.path, pathA);

    const stillIndexed = searchContextIndex(database, { query: "gamma" });
    assert.equal(stillIndexed.hits.length, 1);
    assert.equal(stillIndexed.hits[0]?.path, pathB);

    const obsolete = searchContextIndex(database, { query: "alpha" });
    assert.ok(obsolete.hits.some((hit) => hit.path === pathA));
  } finally {
    database.close();
  }
});

test("[CTX-02] reindexação idempotente ignora conteúdo inalterado", () => {
  const database = openIndexDatabase();
  try {
    const path = "README.md";
    const content = "# Projeto\n\nTexto inicial.\n";
    const first = indexContextFile(database, { path, content });
    assert.equal(first.indexed, true);
    assert.ok(first.chunkCount > 0);

    const second = indexContextFile(database, { path, content });
    assert.equal(second.indexed, false);
    assert.equal(second.skippedReason, "unchanged");
  } finally {
    database.close();
  }
});

test("[CTX-02] caminho de erro retorna INVALID_STATE sem efeito colateral", () => {
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: "ok.ts",
      content: "const ok = true;\n",
    });

    assert.throws(
      () => searchContextIndex(database, { query: "   " }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const stable = searchContextIndex(database, { query: "ok" });
    assert.equal(stable.hits.length, 1);
  } finally {
    database.close();
  }
});
