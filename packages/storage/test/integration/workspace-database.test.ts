import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  openWorkspaceDatabase,
  resolveWorkspaceDatabasePath,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-storage-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

test("[SES-01] reinício do editor reabre sessão com modo, mensagens, ferramentas e anexos persistidos", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-alpha";
    const record = {
      sessionId: "sess-1",
      mode: "agent",
      messagesJson: JSON.stringify([{ role: "user", text: "olá" }]),
      toolsJson: JSON.stringify([{ name: "read_file", state: "done" }]),
      attachmentsJson: JSON.stringify([{ id: "att-1", kind: "file" }]),
    };

    const first = openWorkspaceDatabase({ dataRoot, workspaceId });
    assert.equal(first.journalMode, "wal");
    first.putSessionResume(record);
    first.close();

    const reopened = openWorkspaceDatabase({ dataRoot, workspaceId });
    assert.equal(reopened.journalMode, "wal");
    const sessions = reopened.listSessionResumes();
    reopened.close();

    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0], record);
  });
});

test("[SES-01] workspaces distintos usam arquivos SQLite separados em WAL", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const a = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-a" });
    const b = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-b" });
    assert.notEqual(a.databasePath, b.databasePath);
    assert.equal(a.journalMode, "wal");
    assert.equal(b.journalMode, "wal");
    a.putSessionResume({
      sessionId: "only-a",
      mode: "ask",
      messagesJson: "[]",
      toolsJson: "[]",
      attachmentsJson: "[]",
    });
    a.close();
    b.close();

    const reopenedB = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-b" });
    assert.deepEqual(reopenedB.listSessionResumes(), []);
    reopenedB.close();
  });
});

test("[SES-01] workspaceId inválido retorna INVALID_STATE sem criar diretório", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const invalidId = "../escape";
    assert.throws(
      () => resolveWorkspaceDatabasePath(dataRoot, invalidId),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    const workspacesDir = join(dataRoot, "workspaces");
    await assert.rejects(access(workspacesDir));
  });
});

test("[SES-01] workspaceId vazio retorna INVALID_STATE ao abrir banco", async () => {
  await withTempDataRoot(async (dataRoot) => {
    assert.throws(
      () => openWorkspaceDatabase({ dataRoot, workspaceId: "" }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    const entries = await readdir(dataRoot);
    assert.deepEqual(entries, []);
  });
});
