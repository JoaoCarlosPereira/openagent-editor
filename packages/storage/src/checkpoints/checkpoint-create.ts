import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import { putCasBlob, readCasBlob } from "../cas.js";
import type { CheckpointFileHashes, StoredCheckpointRecord } from "./checkpoint-types.js";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export type CreateCheckpointInput = {
  runId: unknown;
  label?: unknown;
  baseHashes: unknown;
  resultHashes: unknown;
  patchText: unknown;
};

function checkpointInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseFileHashes(raw: unknown, fieldName: string): CheckpointFileHashes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    checkpointInvalid(`Campo '${fieldName}' inválido: esperado objeto de hashes.`);
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    checkpointInvalid(`Campo '${fieldName}' inválido: nenhum arquivo marcado.`);
  }
  const parsed: CheckpointFileHashes = {};
  for (const key of keys) {
    if (!isNonEmptyString(key) || key.includes("\\")) {
      checkpointInvalid(`Campo '${fieldName}' inválido: caminho relativo inválido.`, [key]);
    }
    const hash = record[key];
    if (typeof hash !== "string" || !SHA256_HEX.test(hash.trim())) {
      checkpointInvalid(`Campo '${fieldName}' inválido: hash SHA-256 esperado.`, [key]);
    }
    parsed[key.trim()] = hash.trim().toLowerCase();
  }
  return parsed;
}

function assertMatchingHashKeys(
  baseHashes: CheckpointFileHashes,
  resultHashes: CheckpointFileHashes,
): void {
  const baseKeys = new Set(Object.keys(baseHashes));
  const resultKeys = new Set(Object.keys(resultHashes));
  if (baseKeys.size !== resultKeys.size) {
    checkpointInvalid(
      "baseHashes e resultHashes devem cobrir exatamente os mesmos arquivos da execução.",
    );
  }
  for (const key of baseKeys) {
    if (!resultKeys.has(key)) {
      checkpointInvalid(
        "baseHashes e resultHashes devem cobrir exatamente os mesmos arquivos da execução.",
        [key],
      );
    }
  }
}

function assertRunExists(database: DatabaseSync, runId: string): void {
  const row = database
    .prepare("SELECT id FROM run WHERE id = ?")
    .get(runId) as { id?: string } | undefined;
  if (!row?.id) {
    checkpointInvalid("Run inexistente para checkpoint.", [runId]);
  }
}

function persistHashesBlob(
  database: DatabaseSync,
  casRoot: string,
  files: CheckpointFileHashes,
): string {
  const payload = JSON.stringify({ files });
  const put = putCasBlob(database, casRoot, Buffer.from(payload, "utf8"));
  return put.contentRef;
}

/**
 * SES-03: persiste checkpoint com baseHashes, resultHashes e patchRef no CAS/SQLite.
 */
export function createStoredCheckpoint(
  database: DatabaseSync,
  casRoot: string,
  input: CreateCheckpointInput,
): StoredCheckpointRecord {
  if (!isNonEmptyString(input.runId)) {
    checkpointInvalid("Campo 'runId' ausente ou inválido.");
  }
  const runId = input.runId.trim();
  const baseHashes = parseFileHashes(input.baseHashes, "baseHashes");
  const resultHashes = parseFileHashes(input.resultHashes, "resultHashes");
  assertMatchingHashKeys(baseHashes, resultHashes);

  if (typeof input.patchText !== "string") {
    checkpointInvalid("Campo 'patchText' ausente ou inválido.");
  }
  const patchText = input.patchText;
  if (!patchText.trim()) {
    checkpointInvalid("Campo 'patchText' ausente ou inválido.");
  }

  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== "string") {
      checkpointInvalid("Campo 'label' deve ser string quando presente.");
    }
    const trimmed = input.label.trim();
    label = trimmed.length > 0 ? trimmed : null;
  }

  assertRunExists(database, runId);

  const baseHashesRef = persistHashesBlob(database, casRoot, baseHashes);
  const resultHashesRef = persistHashesBlob(database, casRoot, resultHashes);
  const patchPut = putCasBlob(database, casRoot, Buffer.from(patchText, "utf8"));
  const patchRef = patchPut.contentRef;

  const checkpointId = randomUUID();
  const createdAt = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO checkpoint(
         id, run_id, label, base_hashes_ref, result_hashes_ref, patch_ref, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(checkpointId, runId, label, baseHashesRef, resultHashesRef, patchRef, createdAt);

  return {
    checkpointId,
    runId,
    label,
    baseHashesRef,
    resultHashesRef,
    patchRef,
    createdAt,
  };
}

export function getStoredCheckpointById(
  database: DatabaseSync,
  checkpointId: string,
): StoredCheckpointRecord | null {
  const row = database
    .prepare(
      `SELECT id AS checkpointId, run_id AS runId, label,
              base_hashes_ref AS baseHashesRef, result_hashes_ref AS resultHashesRef,
              patch_ref AS patchRef, created_at AS createdAt
       FROM checkpoint WHERE id = ?`,
    )
    .get(checkpointId) as StoredCheckpointRecord | undefined;
  return row ?? null;
}

export function readCheckpointHashesFromRef(
  database: DatabaseSync,
  casRoot: string,
  contentRef: string,
): CheckpointFileHashes {
  const bytes = readCasBlob(database, casRoot, contentRef);
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
    files?: CheckpointFileHashes;
  };
  if (!parsed.files || typeof parsed.files !== "object") {
    checkpointInvalid("Payload de hashes de checkpoint inválido.");
  }
  return parsed.files;
}

export function readCheckpointPatchFromRef(
  database: DatabaseSync,
  casRoot: string,
  patchRef: string,
): string {
  return Buffer.from(readCasBlob(database, casRoot, patchRef)).toString("utf8");
}
