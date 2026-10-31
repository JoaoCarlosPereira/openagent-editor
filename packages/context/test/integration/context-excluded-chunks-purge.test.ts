import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  executeContextSearchRpc,
  indexContextFile,
  resolveContextExclusionRuleset,
  searchContextIndex,
} from "../../src/index.js";
import { ensureContextIndexSchema } from "../../src/indexer/schema.js";

function openIndexDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

function countIndexedPaths(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM context_index_file")
    .get() as { count: number };
  return row.count;
}

function countFtsRowsForPath(database: DatabaseSync, filePath: string): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM context_file_fts WHERE path = ?")
    .get(filePath) as { count: number };
  return row.count;
}

test("[ERR-04] busca remove trechos de arquivo recém-excluído do índice persistente", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-err04-"));
  writeFileSync(path.join(root, ".gitignore"), "secrets/\n");
  mkdirSync(path.join(root, "secrets"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });

  const publicPath = "src/open.ts";
  const secretPath = "secrets/token.txt";
  writeFileSync(path.join(root, publicPath), "export const visible = true;\n");
  writeFileSync(path.join(root, secretPath), "super-secret-token\n");

  const database = openIndexDatabase();
  try {
    ensureContextIndexSchema(database);

    indexContextFile(database, {
      path: publicPath,
      content: "export const visible = true;\n",
    });
    indexContextFile(database, {
      path: secretPath,
      content: "super-secret-token\n",
    });

    assert.equal(countIndexedPaths(database), 2);
    assert.equal(countFtsRowsForPath(database, secretPath), 1);

    const staleSearch = searchContextIndex(database, { query: "super-secret" });
    assert.equal(staleSearch.hits.length, 1);

    const ruleset = resolveContextExclusionRuleset({ workspaceRoot: root });
    const filteredSearch = searchContextIndex(database, {
      query: "super-secret",
      exclusionRuleset: ruleset,
    });
    assert.equal(filteredSearch.hits.length, 0);
    assert.equal(countIndexedPaths(database), 1);
    assert.equal(countFtsRowsForPath(database, secretPath), 0);
    assert.equal(countFtsRowsForPath(database, publicPath), 1);

    const publicSearch = searchContextIndex(database, {
      query: "visible",
      exclusionRuleset: ruleset,
    });
    assert.equal(publicSearch.hits.length, 1);
  } finally {
    database.close();
  }
});

test("[ERR-04] executeContextSearchRpc purga antes de buscar com exclusões atuais", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-err04-rpc-"));
  writeFileSync(path.join(root, ".gitignore"), "private/\n");
  mkdirSync(path.join(root, "private"), { recursive: true });

  const secretPath = "private/creds.txt";
  writeFileSync(path.join(root, secretPath), "api-key-leaked\n");

  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: secretPath,
      content: "api-key-leaked\n",
    });
    assert.equal(countFtsRowsForPath(database, secretPath), 1);

    const hits = executeContextSearchRpc(
      database,
      { query: "api-key" },
      { workspaceRoot: root },
    );
    assert.equal(hits.hits.length, 0);
    assert.equal(countFtsRowsForPath(database, secretPath), 0);
  } finally {
    database.close();
  }
});

test("[ERR-04] exclusions_json inválido retorna INVALID_STATE sem efeito colateral", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oa-ctx-err04-inv-"));
  const filePath = "note.txt";
  writeFileSync(path.join(root, filePath), "conteudo-indexado\n");

  const database = openIndexDatabase();
  try {
    indexContextFile(database, {
      path: filePath,
      content: "conteudo-indexado\n",
    });
    assert.equal(countIndexedPaths(database), 1);

    assert.throws(
      () =>
        executeContextSearchRpc(
          database,
          { query: "conteudo" },
          { workspaceRoot: root, workspaceExclusionPatterns: { bad: true } },
        ),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(countIndexedPaths(database), 1);
    assert.equal(countFtsRowsForPath(database, filePath), 1);
  } finally {
    database.close();
  }
});
