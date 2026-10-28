import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

export const CAS_CONTENT_REF_PREFIX = "sha256:";

export type PutCasBlobResult = {
  contentRef: string;
  byteSize: number;
  deduplicated: boolean;
};

function casInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function formatCasContentRef(contentHashHex: string): string {
  return `${CAS_CONTENT_REF_PREFIX}${contentHashHex}`;
}

export function parseCasContentRef(contentRef: string): string {
  if (!contentRef.startsWith(CAS_CONTENT_REF_PREFIX)) {
    casInvalid("contentRef CAS inválido: prefixo sha256: ausente.", [contentRef]);
  }
  const hex = contentRef.slice(CAS_CONTENT_REF_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    casInvalid("contentRef CAS inválido: hash SHA-256 esperado.", [contentRef]);
  }
  return hex;
}

function resolveCasBlobPath(casRoot: string, contentHashHex: string): string {
  const shard = contentHashHex.slice(0, 2);
  return join(casRoot, shard, contentHashHex);
}

function ensureCasShardDirectory(casRoot: string, contentHashHex: string): string {
  const shardDirectory = join(casRoot, contentHashHex.slice(0, 2));
  mkdirSync(shardDirectory, { recursive: true });
  return shardDirectory;
}

/**
 * Persiste bytes no CAS SHA-256 do workspace, deduplicando por hash de conteúdo.
 */
export function putCasBlob(
  database: DatabaseSync,
  casRoot: string,
  content: Uint8Array,
): PutCasBlobResult {
  if (!(content instanceof Uint8Array)) {
    casInvalid("conteúdo CAS inválido: esperado Uint8Array.");
  }

  const contentHashHex = sha256Hex(content);
  const contentRef = formatCasContentRef(contentHashHex);
  const byteSize = content.byteLength;

  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database
      .prepare(
        "SELECT content_hash AS contentHash, ref_count AS refCount FROM cas_blob WHERE content_hash = ?",
      )
      .get(contentHashHex) as { contentHash?: string; refCount?: number } | undefined;

    if (existing?.contentHash === contentHashHex) {
      database
        .prepare("UPDATE cas_blob SET ref_count = ref_count + 1 WHERE content_hash = ?")
        .run(contentHashHex);
      const blobPath = resolveCasBlobPath(casRoot, contentHashHex);
      if (!existsSync(blobPath)) {
        ensureCasShardDirectory(casRoot, contentHashHex);
        writeFileSync(blobPath, content);
      }
      database.exec("COMMIT");
      return { contentRef, byteSize, deduplicated: true };
    }

    ensureCasShardDirectory(casRoot, contentHashHex);
    const blobPath = resolveCasBlobPath(casRoot, contentHashHex);
    writeFileSync(blobPath, content);

    database
      .prepare(
        "INSERT INTO cas_blob(content_hash, byte_size, ref_count) VALUES (?, ?, 1)",
      )
      .run(contentHashHex, byteSize);

    database.exec("COMMIT");
    return { contentRef, byteSize, deduplicated: false };
  } catch (cause) {
    database.exec("ROLLBACK");
    if (cause instanceof ProtocolError) {
      throw cause;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    casInvalid("falha ao gravar blob no CAS.", [detail]);
  }
}

/**
 * Lê bytes endereçados por contentRef (`sha256:<hex>`).
 */
export function readCasBlob(
  database: DatabaseSync,
  casRoot: string,
  contentRef: string,
): Uint8Array {
  const contentHashHex = parseCasContentRef(contentRef);

  const row = database
    .prepare("SELECT content_hash AS contentHash FROM cas_blob WHERE content_hash = ?")
    .get(contentHashHex) as { contentHash?: string } | undefined;

  if (row?.contentHash !== contentHashHex) {
    casInvalid("contentRef CAS inexistente.", [contentRef]);
  }

  const blobPath = resolveCasBlobPath(casRoot, contentHashHex);
  let bytes: Buffer;
  try {
    bytes = readFileSync(blobPath);
  } catch {
    casInvalid("blob CAS ausente no disco.", [contentRef]);
  }

  const actualHash = sha256Hex(bytes);
  if (actualHash !== contentHashHex) {
    casInvalid("integridade CAS violada: hash do arquivo difere do contentRef.", [
      contentRef,
    ]);
  }

  return bytes;
}
