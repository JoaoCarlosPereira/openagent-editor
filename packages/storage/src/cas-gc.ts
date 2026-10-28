import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { parseCasContentRef } from "./cas.js";

function gcInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function resolveCasBlobPath(casRoot: string, contentHashHex: string): string {
  const shard = contentHashHex.slice(0, 2);
  return join(casRoot, shard, contentHashHex);
}

/**
 * Decrementa ref_count de um blob CAS endereçado por contentRef.
 */
export function releaseCasBlobRef(database: DatabaseSync, contentRef: string): void {
  const contentHashHex = parseCasContentRef(contentRef);
  const row = database
    .prepare("SELECT ref_count AS refCount FROM cas_blob WHERE content_hash = ?")
    .get(contentHashHex) as { refCount?: number } | undefined;

  if (row?.refCount === undefined) {
    gcInvalid("contentRef CAS inexistente para liberação.", [contentRef]);
  }
  if (row.refCount <= 0) {
    gcInvalid("ref_count CAS já zerado; liberação inválida.", [contentRef]);
  }

  database
    .prepare("UPDATE cas_blob SET ref_count = ref_count - 1 WHERE content_hash = ?")
    .run(contentHashHex);
}

export type CollectUnreferencedCasBlobsResult = {
  removedBlobCount: number;
};

/**
 * Remove blobs com ref_count=0 do SQLite e do disco.
 */
export function collectUnreferencedCasBlobs(
  database: DatabaseSync,
  casRoot: string,
): CollectUnreferencedCasBlobsResult {
  const stale = database
    .prepare("SELECT content_hash AS contentHash FROM cas_blob WHERE ref_count = 0")
    .all() as { contentHash: string }[];

  for (const row of stale) {
    const blobPath = resolveCasBlobPath(casRoot, row.contentHash);
    try {
      unlinkSync(blobPath);
    } catch {
      // Arquivo ausente no disco: ainda removemos a linha órfã.
    }
    database.prepare("DELETE FROM cas_blob WHERE content_hash = ?").run(row.contentHash);
  }

  return { removedBlobCount: stale.length };
}
