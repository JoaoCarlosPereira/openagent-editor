import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  openWorkspaceDatabase,
  runStorageMigrations,
  STORAGE_MIGRATIONS,
  type StorageMigration,
} from "../../src/index.js";

async function withTempDatabase(run: (database: DatabaseSync) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "openagent-migrate-"));
  const databasePath = join(directory, "test.sqlite3");
  const database = new DatabaseSync(databasePath);
  try {
    await run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("[SES-01] runner aplica migrações e reinício preserva sessão com modo, mensagens, ferramentas e anexos", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-storage-migrate-"));
  try {
    const workspaceId = "ws-migrate";
    const record = {
      sessionId: "sess-migrate",
      mode: "plan",
      messagesJson: JSON.stringify([{ role: "user", text: "persistir" }]),
      toolsJson: JSON.stringify([{ name: "grep", state: "pending" }]),
      attachmentsJson: JSON.stringify([{ id: "a1", kind: "folder" }]),
    };

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    first.putSessionResume(record);
    first.close();

    const reopened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sessions = reopened.listSessionResumes();
    reopened.close();

    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0], record);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-01] migração com falha faz rollback e retorna INVALID_STATE sem tabela parcial", async () => {
  await withTempDatabase((database) => {
    const catalog: StorageMigration[] = [
      ...STORAGE_MIGRATIONS,
      {
        version: 2,
        description: "falha proposital",
        up(db) {
          db.exec("CREATE TABLE migration_probe (id INTEGER PRIMARY KEY)");
          throw new Error("falha simulada");
        },
      },
    ];

    runStorageMigrations(database, STORAGE_MIGRATIONS);

    assert.throws(
      () => runStorageMigrations(database, catalog),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const applied = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[];
    assert.deepEqual(applied.map((row) => row.version), [1]);

    const probe = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'",
      )
      .get() as { name?: string } | undefined;
    assert.equal(probe, undefined);
  });
});

test("[SES-01] catálogo inválido retorna INVALID_STATE sem alterar banco", async () => {
  await withTempDatabase((database) => {
    assert.throws(
      () =>
        runStorageMigrations(database, [
          {
            version: 2,
            description: "lacuna",
            up() {
              /* noop */
            },
          },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .all() as { name: string }[];
    assert.equal(tables.length, 0);
  });
});
