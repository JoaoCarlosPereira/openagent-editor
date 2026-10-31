import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export type StorageMigration = {
  version: number;
  description: string;
  up: (database: DatabaseSync) => void;
};

export type RunStorageMigrationsResult = {
  appliedVersions: number[];
  currentVersion: number;
};

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

function migrationInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function ensureMigrationsTable(database: DatabaseSync): void {
  database.exec(MIGRATIONS_TABLE_SQL);
}

function listAppliedVersions(database: DatabaseSync): number[] {
  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as { version: number }[];
  return rows.map((row) => row.version);
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function baselineFromLegacySchema(database: DatabaseSync): number[] {
  if (tableExists(database, "storage_meta")) {
    const metaRow = database
      .prepare("SELECT value FROM storage_meta WHERE key = 'schema_version'")
      .get() as { value?: string } | undefined;
    if (metaRow?.value) {
      const parsed = Number.parseInt(metaRow.value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return [parsed];
      }
    }
  }
  if (tableExists(database, "session_resume")) {
    return [1];
  }
  return [];
}

function recordBaselineIfNeeded(database: DatabaseSync, baselineVersions: number[]): void {
  if (baselineVersions.length === 0) {
    return;
  }
  const insert = database.prepare(
    `INSERT OR IGNORE INTO schema_migrations(version, description) VALUES (?, ?)`,
  );
  for (const version of baselineVersions) {
    insert.run(version, "baseline legado (pré schema_migrations)");
  }
}

function validateMigrationCatalog(migrations: StorageMigration[]): void {
  if (migrations.length === 0) {
    migrationInvalid("catálogo de migrações vazio.");
  }
  const versions = migrations.map((m) => m.version);
  const unique = new Set(versions);
  if (unique.size !== versions.length) {
    migrationInvalid("versões de migração duplicadas no catálogo.");
  }
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      migrationInvalid("cada migração deve ter version inteiro >= 1.", [
        `recebido: ${migration.version}`,
      ]);
    }
  }
  const sorted = [...versions].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index + 1) {
      migrationInvalid("lacuna na sequência de migrações do catálogo.", [
        `esperado ${index + 1}, catálogo=${sorted.join(",")}`,
      ]);
    }
  }
}

/**
 * Aplica migrações pendentes em transação; falha em qualquer passo reverte o lote atual.
 */
export function runStorageMigrations(
  database: DatabaseSync,
  migrations: StorageMigration[],
): RunStorageMigrationsResult {
  validateMigrationCatalog(migrations);
  ensureMigrationsTable(database);

  let applied = listAppliedVersions(database);
  if (applied.length === 0) {
    const baseline = baselineFromLegacySchema(database);
    recordBaselineIfNeeded(database, baseline);
    applied = listAppliedVersions(database);
  }

  const appliedSet = new Set(applied);
  const pending = migrations.filter((migration) => !appliedSet.has(migration.version));
  const newlyApplied: number[] = [];

  for (const migration of pending) {
    database.exec("BEGIN IMMEDIATE");
    try {
      migration.up(database);
      database
        .prepare(
          `INSERT INTO schema_migrations(version, description) VALUES (?, ?)`,
        )
        .run(migration.version, migration.description);
      database.exec("COMMIT");
      newlyApplied.push(migration.version);
      appliedSet.add(migration.version);
    } catch (cause) {
      database.exec("ROLLBACK");
      const detail =
        cause instanceof Error ? cause.message : String(cause);
      migrationInvalid(
        `migração ${migration.version} falhou; alterações revertidas.`,
        [detail],
      );
    }
  }

  const allVersions = listAppliedVersions(database);

  return {
    appliedVersions: newlyApplied,
    currentVersion: allVersions.length > 0 ? Math.max(...allVersions) : 0,
  };
}
