import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { openWorkspaceDatabase, sha256Hex } from "../../src/index.js";

function countCasBlobFiles(casRoot: string): number {
  if (!existsSync(casRoot)) {
    return 0;
  }
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

test("[SES-07] apagar sessão remove mensagens locais e GC elimina blobs sem referência", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-gc-delete-"));
  const workspaceId = "ws-gc-delete";
  const sessionId = "sess-to-delete";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const messageBytes = Buffer.from(JSON.stringify([{ role: "user", text: "mensagem local" }]), "utf8");
    const attachmentBytes = Buffer.from("anexo da sessão", "utf8");
    const messagePut = db.putCasBlob(messageBytes);
    const attachmentPut = db.putCasBlob(attachmentBytes);

    db.putSessionResume({
      sessionId,
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", contentRef: messagePut.contentRef }]),
      toolsJson: "[]",
      attachmentsJson: JSON.stringify([{ id: "att-1", contentRef: attachmentPut.contentRef }]),
    });

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    assert.equal(countCasBlobFiles(casRoot), 2);
    assert.equal(db.listSessionResumes().length, 1);

    const result = db.deleteSession(sessionId);
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.releasedRefCount, 2);
    assert.equal(result.removedBlobCount, 2);
    assert.deepEqual(db.listSessionResumes(), []);
    assert.equal(countCasBlobFiles(casRoot), 0);

    const sqlite = new DatabaseSync(join(dataRoot, "workspaces", workspaceId, "state.sqlite3"));
    const blobRows = sqlite.prepare("SELECT COUNT(*) AS total FROM cas_blob").get() as {
      total: number;
    };
    sqlite.close();
    assert.equal(blobRows.total, 0);

    assert.throws(
      () => db.readCasBlob(messagePut.contentRef),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-07] blob compartilhado permanece quando outra sessão ainda referencia", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-gc-shared-"));
  const workspaceId = "ws-gc-shared";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const payload = Buffer.from("conteúdo compartilhado", "utf8");
    const firstPut = db.putCasBlob(payload);
    const secondPut = db.putCasBlob(payload);
    assert.equal(firstPut.contentRef, secondPut.contentRef);

    db.putSessionResume({
      sessionId: "sess-keep",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", contentRef: firstPut.contentRef }]),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });
    db.putSessionResume({
      sessionId: "sess-drop",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", contentRef: secondPut.contentRef }]),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });

    const casRoot = join(dataRoot, "workspaces", workspaceId, "cas");
    assert.equal(countCasBlobFiles(casRoot), 1);

    db.deleteSession("sess-drop");
    assert.equal(db.listSessionResumes().length, 1);
    assert.equal(countCasBlobFiles(casRoot), 1);
    assert.equal(Buffer.from(db.readCasBlob(firstPut.contentRef)).toString("utf8"), payload.toString("utf8"));

    const sqlite = new DatabaseSync(join(dataRoot, "workspaces", workspaceId, "state.sqlite3"));
    const row = sqlite
      .prepare("SELECT ref_count AS refCount FROM cas_blob WHERE content_hash = ?")
      .get(sha256Hex(payload)) as { refCount: number };
    sqlite.close();
    assert.equal(row.refCount, 1);

    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("[SES-07] sessão inexistente ou sessionId inválido retorna INVALID_STATE sem efeito colateral", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-gc-error-"));
  const workspaceId = "ws-gc-error";
  try {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId });
    const messagePut = db.putCasBlob(Buffer.from("persistido", "utf8"));
    db.putSessionResume({
      sessionId: "sess-stays",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", contentRef: messagePut.contentRef }]),
      toolsJson: "[]",
      attachmentsJson: "[]",
    });

    assert.throws(
      () => db.deleteSession("sess-missing"),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.throws(
      () => db.deleteSession(""),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(db.listSessionResumes().length, 1);
    assert.doesNotThrow(() => db.readCasBlob(messagePut.contentRef));
    db.close();
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
