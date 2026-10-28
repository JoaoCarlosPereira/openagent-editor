import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  describeContextIndexSize,
  executeContextClearRpc,
  indexContextFile,
  searchContextIndex,
} from "../../src/index.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("[CTX-04] executeContextClearRpc informa escopo/tamanho e apaga índice do workspace", () => {
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: "src/a.ts",
      content: "export const alpha = 1;\nexport const beta = 2;\n",
    });
    indexContextFile(database, {
      path: "src/b.ts",
      content: "export const gamma = 3;\n",
    });

    const before = describeContextIndexSize(database);
    assert.ok(before.indexedFileCount >= 2);
    assert.ok(before.chunkCount >= 2);
    assert.ok(before.lexicalBytes > 0);

    const result = executeContextClearRpc(database, { scope: "workspace" });
    assert.equal(result.cleared, true);
    assert.equal(result.scope, "workspace");
    assert.deepEqual(result.size, before);

    const after = describeContextIndexSize(database);
    assert.equal(after.indexedFileCount, 0);
    assert.equal(after.chunkCount, 0);
    assert.equal(after.lexicalBytes, 0);

    const hits = searchContextIndex(database, { query: "gamma" });
    assert.equal(hits.hits.length, 0);
  } finally {
    database.close();
  }
});

test("[CTX-04] executeContextClearRpc usa escopo workspace por padrão", () => {
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: "README.md",
      content: "# Título\n\nConteúdo indexado.\n",
    });

    const result = executeContextClearRpc(database, {});
    assert.equal(result.scope, "workspace");
    assert.equal(result.cleared, true);
    assert.ok(result.size.indexedFileCount >= 1);
  } finally {
    database.close();
  }
});

test("[CTX-04] caminho de erro retorna INVALID_STATE sem efeito colateral", () => {
  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: "keep.ts",
      content: "const value = 42;\n",
    });
    const before = describeContextIndexSize(database);

    assert.throws(
      () => executeContextClearRpc(database, { scope: "session" }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.deepEqual(describeContextIndexSize(database), before);
  } finally {
    database.close();
  }
});
