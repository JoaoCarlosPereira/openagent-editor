import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  executeContextIndexRpc,
  indexContextFile,
  reindexContextFileOnSave,
  searchContextIndex,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("[CTX-02] reindexação ao salvar encontra texto novo sem reconstruir índice inteiro", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-save-"));
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
    });
    reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: pathB,
    });

    assert.equal(searchContextIndex(database, { query: "gamma" }).hits.length, 1);

    writeFileSync(
      path.join(root, pathA),
      "export const alpha = 1;\nexport const beta = 2;\nexport const delta = 4;\n",
    );
    const saveResult = reindexContextFileOnSave(database, {
      workspaceRoot: root,
      relativePath: pathA,
    });
    assert.equal(saveResult.indexed, true);

    const afterSave = searchContextIndex(database, { query: "delta" });
    assert.equal(afterSave.hits.length, 1);
    assert.equal(afterSave.hits[0]?.path, pathA);

    assert.equal(searchContextIndex(database, { query: "gamma" }).hits.length, 1);
  } finally {
    database.close();
  }
});

test("[CTX-02] executeContextIndexRpc reindexa paths salvos incrementalmente", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-rpc-"));
  const rel = "notes.txt";
  writeFileSync(path.join(root, rel), "versão inicial\n");

  const database = openIndexDatabase();
  try {
    indexContextFile(database, { path: rel, content: "versão inicial\n" });
    writeFileSync(path.join(root, rel), "versão inicial\nlinha nova\n");

    const rpc = executeContextIndexRpc(
      database,
      { paths: [rel] },
      { workspaceRoot: root },
    );
    assert.equal(rpc.indexed, 1);

    const hits = searchContextIndex(database, { query: "nova" });
    assert.equal(hits.hits.length, 1);
  } finally {
    database.close();
  }
});

test("[CTX-02] caminho de erro retorna INVALID_STATE sem efeito colateral", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-err-"));
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: "stable.ts",
      content: "const stable = true;\n",
    });

    assert.throws(
      () =>
        executeContextIndexRpc(database, { paths: ["   "] }, { workspaceRoot: root }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => searchContextIndex(database, { query: "   " }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(searchContextIndex(database, { query: "stable" }).hits.length, 1);
  } finally {
    database.close();
  }
});
