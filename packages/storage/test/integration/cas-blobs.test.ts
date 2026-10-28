import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  formatCasContentRef,
  openWorkspaceDatabase,
  sha256Hex,
  STORAGE_SCHEMA_VERSION,
} from "../../src/index.js";

function countCasBlobFiles(casRoot: string): number {
  let total = 0;
  for (const shard of readdirSync(casRoot)) {
    const shardPath = join(casRoot, shard);
    if (!statSync(shardPath).isDirectory()) {
      continue;
    }
    total += readdirSync(shardPath).length;
  }
  return total;
}

test("[SES-01] CAS SHA-256 persiste anexo e reinício do storage recupera modo, mensagens, ferramentas e anexos", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-cas-restart-"));
  const workspaceId = "ws-cas-restart";
  try {
    const attachmentBytes = Buffer.from("conteúdo do anexo persistido", "utf8");
    const messageBytes = Buffer.from(JSON.stringify([{ role: "user", text: "olá" }]), "utf8");

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    const attachmentPut = first.putCasBlob(attachmentBytes);
    const messagePut = first.putCasBlob(messageBytes);

    const record = {
      sessionId: "sess-cas",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", contentRef: messagePut.contentRef }]),
      toolsJson: JSON.stringify([{ name: "read", state: "ready" }]),
      attachmentsJson: JSON.stringify([
        { id: "att-1", kind: "file", contentRef: attachmentPut.contentRef },
      ]),
    };
    first.putSessionResume(record);
    first.close();

    const reopened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const sessions = reopened.listSessionResumes();
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0], record);

    const attachments = JSON.parse(sessions[0].attachmentsJson) as { contentRef: string }[];
    const attachmentRef = attachments[0]?.contentRef;
    assert.ok(attachmentRef);
    const restoredAttachment = reopened.readCasBlob(attachmentRef);
    assert.equal(Buffer.from(restoredAttachment).toString("utf8"), attachmentBytes.toString("utf8"));

    const messages = JSON.parse(sessions[0].messagesJson) as { contentRef: string }[];
    const messageRef = messages[0]?.contentRef;
    assert.ok(messageRef);
    const restoredMessage = reopened.readCasBlob(messageRef);
    assert.deepEqual(JSON.parse(Buffer.from(restoredMessage).toString("utf8")), [
      { role: "user", text: "olá" },
    ]);
    reopened.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-01] CAS deduplica blobs idênticos pelo hash SHA-256", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-cas-dedup-"));
  const workspaceId = "ws-cas-dedup";
  try {
    const payload = Buffer.from("bytes compartilhados entre mensagens", "utf8");
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });

    const firstPut = db.putCasBlob(payload);
    const secondPut = db.putCasBlob(payload);

    assert.equal(firstPut.contentRef, secondPut.contentRef);
    assert.equal(firstPut.deduplicated, false);
    assert.equal(secondPut.deduplicated, true);
    assert.equal(firstPut.byteSize, payload.byteLength);

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    assert.equal(countCasBlobFiles(casRoot), 1);

    const database = new DatabaseSync(join(dataRoot, "workspaces", workspaceId, "state.sqlite3"));
    const row = database
      .prepare("SELECT ref_count AS refCount FROM cas_blob WHERE content_hash = ?")
      .get(sha256Hex(payload)) as { refCount: number };
    database.close();
    assert.equal(row.refCount, 2);

    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-01] contentRef inválido ou inexistente retorna INVALID_STATE sem efeito colateral", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-cas-error-"));
  const workspaceId = "ws-cas-error";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const missingHash = "a".repeat(64);
    const missingRef = formatCasContentRef(missingHash);

    assert.throws(
      () => db.readCasBlob("cas:invalid-prefix"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => db.readCasBlob(missingRef),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => db.putCasBlob(null as unknown as Uint8Array),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.deepEqual(db.listSessionResumes(), []);
    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-01] migração CAS registra schema_version atualizado", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-cas-schema-"));
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-cas-schema" });
    const sqlite = new DatabaseSync(db.databasePath);
    const meta = sqlite
      .prepare("SELECT value FROM storage_meta WHERE key = 'schema_version'")
      .get() as { value: string };
    sqlite.close();
    db.close();
    assert.equal(meta.value, String(STORAGE_SCHEMA_VERSION));
    assert.equal(STORAGE_SCHEMA_VERSION, 5);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
