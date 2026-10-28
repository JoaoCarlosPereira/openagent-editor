import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { STORAGE_SCHEMA_VERSION } from "./schema-version.js";

const BACKUP_MANIFEST_VERSION = 1;
const BACKUP_MANIFEST_FILE = "manifest.json";
const BACKUP_DATABASE_FILE = "state.sqlite3";

export type WorkspaceStorageBackupManifest = {
  version: typeof BACKUP_MANIFEST_VERSION;
  workspaceId: string;
  storageSchemaVersion: number;
  databaseFile: string;
  casBlobs: { contentHashHex: string; relativePath: string }[];
};

export type CreateWorkspaceStorageBackupInput = {
  database: DatabaseSync;
  databasePath: string;
  casRoot: string;
  workspaceId: string;
  backupDirectory: string;
};

export type CreateWorkspaceStorageBackupResult = {
  backupDirectory: string;
  manifestPath: string;
  blobCount: number;
};

export type RestoreWorkspaceStorageBackupInput = {
  backupDirectory: string;
  dataRoot: string;
  workspaceId: string;
};

export type RestoreWorkspaceStorageBackupResult = {
  workspaceDirectory: string;
  databasePath: string;
  casRoot: string;
};

function backupInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function resolveCasBlobPath(casRoot: string, contentHashHex: string): string {
  return join(casRoot, contentHashHex.slice(0, 2), contentHashHex);
}

function casBlobRelativePath(contentHashHex: string): string {
  return join("cas", contentHashHex.slice(0, 2), contentHashHex);
}

function listReferencedCasHashes(database: DatabaseSync): string[] {
  const rows = database
    .prepare(
      `SELECT content_hash AS contentHash
       FROM cas_blob
       WHERE ref_count > 0
       ORDER BY content_hash`,
    )
    .all() as { contentHash: string }[];
  return rows.map((row) => row.contentHash);
}

function readBackupManifest(backupDirectory: string): WorkspaceStorageBackupManifest {
  const manifestPath = join(backupDirectory, BACKUP_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    backupInvalid("backup inválido: manifest.json ausente.", [backupDirectory]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    backupInvalid("backup inválido: manifest.json ilegível.", [manifestPath]);
  }
  if (typeof parsed !== "object" || parsed === null) {
    backupInvalid("backup inválido: manifest.json malformado.");
  }
  const manifest = parsed as WorkspaceStorageBackupManifest;
  if (manifest.version !== BACKUP_MANIFEST_VERSION) {
    backupInvalid("backup inválido: versão de manifesto não suportada.", [
      String(manifest.version),
    ]);
  }
  if (!manifest.workspaceId || typeof manifest.workspaceId !== "string") {
    backupInvalid("backup inválido: workspaceId ausente no manifesto.");
  }
  if (!Array.isArray(manifest.casBlobs)) {
    backupInvalid("backup inválido: lista casBlobs ausente no manifesto.");
  }
  return manifest;
}

/**
 * Snapshot consistente do SQLite (WAL checkpoint) e blobs CAS referenciados (SES-01).
 */
export function createWorkspaceStorageBackup(
  input: CreateWorkspaceStorageBackupInput,
): CreateWorkspaceStorageBackupResult {
  const { database, databasePath, casRoot, workspaceId, backupDirectory } = input;

  if (!existsSync(databasePath)) {
    backupInvalid("backup inválido: banco SQLite ausente.", [databasePath]);
  }

  mkdirSync(backupDirectory, { recursive: true });

  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  const casHashes = listReferencedCasHashes(database);
  const casBlobs: WorkspaceStorageBackupManifest["casBlobs"] = [];

  for (const contentHashHex of casHashes) {
    const sourcePath = resolveCasBlobPath(casRoot, contentHashHex);
    if (!existsSync(sourcePath)) {
      backupInvalid("backup inválido: blob CAS referenciado ausente no disco.", [
        contentHashHex,
      ]);
    }
    const relativePath = casBlobRelativePath(contentHashHex);
    const destinationPath = join(backupDirectory, relativePath);
    mkdirSync(join(backupDirectory, "cas", contentHashHex.slice(0, 2)), {
      recursive: true,
    });
    cpSync(sourcePath, destinationPath);
    casBlobs.push({ contentHashHex, relativePath });
  }

  const manifest: WorkspaceStorageBackupManifest = {
    version: BACKUP_MANIFEST_VERSION,
    workspaceId,
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    databaseFile: BACKUP_DATABASE_FILE,
    casBlobs,
  };

  const manifestPath = join(backupDirectory, BACKUP_MANIFEST_FILE);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  cpSync(databasePath, join(backupDirectory, BACKUP_DATABASE_FILE));

  return {
    backupDirectory,
    manifestPath,
    blobCount: casBlobs.length,
  };
}

/**
 * Restaura snapshot de workspace a partir de backup consistente (SES-01).
 */
export function restoreWorkspaceStorageBackup(
  input: RestoreWorkspaceStorageBackupInput,
): RestoreWorkspaceStorageBackupResult {
  const { backupDirectory, dataRoot, workspaceId } = input;
  const manifest = readBackupManifest(backupDirectory);

  if (manifest.workspaceId !== workspaceId) {
    backupInvalid("backup inválido: workspaceId não corresponde ao manifesto.", [
      workspaceId,
      manifest.workspaceId,
    ]);
  }

  const databaseSource = join(backupDirectory, manifest.databaseFile);
  if (!existsSync(databaseSource)) {
    backupInvalid("backup inválido: state.sqlite3 ausente.", [databaseSource]);
  }

  for (const blob of manifest.casBlobs) {
    const blobSource = join(backupDirectory, blob.relativePath);
    if (!existsSync(blobSource)) {
      backupInvalid("backup inválido: blob CAS ausente no pacote.", [blob.relativePath]);
    }
  }

  const workspaceDirectory = join(dataRoot, "workspaces", workspaceId);
  const casRoot = join(workspaceDirectory, "cas");
  mkdirSync(casRoot, { recursive: true });

  for (const blob of manifest.casBlobs) {
    const blobSource = join(backupDirectory, blob.relativePath);
    const destinationPath = join(workspaceDirectory, blob.relativePath);
    mkdirSync(join(workspaceDirectory, "cas", blob.contentHashHex.slice(0, 2)), {
      recursive: true,
    });
    cpSync(blobSource, destinationPath);
  }

  const databasePath = join(workspaceDirectory, BACKUP_DATABASE_FILE);
  cpSync(databaseSource, databasePath);

  return { workspaceDirectory, databasePath, casRoot };
}
