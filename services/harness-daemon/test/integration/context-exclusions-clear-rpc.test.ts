import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  connectHarnessClient,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type HarnessClient,
} from "@openagent/protocol";
import { openWorkspaceDatabase } from "@openagent/storage";
import { startHarnessDaemon } from "../../src/index.js";

async function connect(address: string, workspaceId: string, workspaceRoot: string): Promise<HarnessClient> {
  return connectHarnessClient({
    address,
    workspaceHello: {
      type: "workspace.hello", workspaceId, workspaceRoot,
      providerProfileId: "default", mode: "agent", rulesRef: "default",
      mcpServerIds: [], sessionIds: [],
    },
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof ProtocolError && error.code === code);
}

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ctx-excl-clear-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "ws-a");
  const otherRoot = path.join(root, "ws-b");
  await mkdir(workspaceRoot);
  await mkdir(otherRoot);
  await writeFile(path.join(workspaceRoot, "secret.txt"), "secretword");
  await writeFile(path.join(workspaceRoot, "public.txt"), "publicword");
  await writeFile(path.join(otherRoot, "secret.txt"), "secretword");
  const runtimeDirectory = path.join(root, "runtime");
  return { root, workspaceRoot, otherRoot, runtimeDirectory };
}

test("[CTX-03] exclusões persistem após reinício do daemon e valem para índice, busca e contexto", async (t) => {
  const { root, workspaceRoot, runtimeDirectory } = await fixture(t);
  let daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory });
  let client = await connect(daemon.address, "ws-a", workspaceRoot);
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt", "public.txt"] });
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 1);

  await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: ["secret.txt"] });
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 0);
  client.close();
  await daemon.stop();

  daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory });
  t.after(async () => daemon.stop());
  client = await connect(daemon.address, "ws-a", workspaceRoot);
  t.after(() => client.close());
  assert.deepEqual((await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns, ["secret.txt"]);
  // Nova indexação do caminho excluído é ignorada e a busca segue sem o trecho.
  const reindex = await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt"] });
  assert.equal(reindex.indexed, 0);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 0);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "publicword" })).hits.length, 1);
  const attach = await client.callRpc(RPC_METHOD.CONTEXT_ATTACH, { attachments: [
    { id: "s", kind: "file", path: path.join(workspaceRoot, "secret.txt"), previewText: "secretword" },
    { id: "p", kind: "file", path: path.join(workspaceRoot, "public.txt"), previewText: "publicword" },
  ] });
  assert.deepEqual(attach.sources.map((source) => source.id), ["p"]);
});

test("[CTX-03] exclusões inválidas retornam INVALID_STATE sem alterar regras nem índice", async (t) => {
  const { root, workspaceRoot, runtimeDirectory } = await fixture(t);
  const daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory });
  t.after(async () => daemon.stop());
  const client = await connect(daemon.address, "ws-a", workspaceRoot);
  t.after(() => client.close());
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt"] });
  await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: ["keep.txt"] });

  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: ["a", "a"] }), PROTOCOL_ERROR_CODES.INVALID_STATE);
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: [""] }), PROTOCOL_ERROR_CODES.INVALID_STATE);
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: "x" as unknown as string[] }), PROTOCOL_ERROR_CODES.INVALID_STATE);
  assert.deepEqual((await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns, ["keep.txt"]);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 1);
});

test("[CTX-03] falha de persistência não confirma sucesso e preserva regras e índice", async (t) => {
  const { root, workspaceRoot, runtimeDirectory } = await fixture(t);
  const daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory });
  t.after(async () => daemon.stop());
  const client = await connect(daemon.address, "ws-a", workspaceRoot);
  t.after(() => client.close());
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt"] });

  const db = openWorkspaceDatabase({ dataRoot: root, workspaceId: "ws-a" });
  const sqlite = new DatabaseSync(db.databasePath);
  sqlite.exec(`CREATE TRIGGER fail_exclusions BEFORE UPDATE OF exclusions_json ON workspace
    BEGIN SELECT RAISE(ABORT, 'falha simulada de persistência'); END;`);
  sqlite.close();
  db.close();

  await assert.rejects(client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_SET, { patterns: ["secret.txt"] }), ProtocolError);
  assert.deepEqual((await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns, []);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 1);
});

test("[CTX-04] prévia obsoleta (mesmo tamanho), replay e confirmação sem prévia retornam erro estável sem remover dados", async (t) => {
  const { root, workspaceRoot, otherRoot, runtimeDirectory } = await fixture(t);
  const daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory });
  t.after(async () => daemon.stop());
  const client = await connect(daemon.address, "ws-a", workspaceRoot);
  const other = await connect(daemon.address, "ws-b", otherRoot);
  t.after(() => client.close());
  t.after(() => other.close());
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt", "public.txt"] });
  await other.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt"] });

  // Sem prévia ou com escopo inválido: INVALID_STATE, nada removido.
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_CLEAR, { scope: "workspace" }), PROTOCOL_ERROR_CODES.INVALID_STATE);
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_CLEAR, { scope: "session", previewToken: "x" }), PROTOCOL_ERROR_CODES.INVALID_STATE);
  const preview = await client.callRpc(RPC_METHOD.CONTEXT_CLEAR_PREVIEW, {});
  assert.equal(preview.size.indexedFileCount, 2);
  assert.equal(preview.scope, "workspace");

  // Mudança concorrente que preserva contagens e tamanho em bytes: "publicword" -> "publicwerd".
  await writeFile(path.join(workspaceRoot, "public.txt"), "publicwerd");
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["public.txt"] });
  const after = await client.callRpc(RPC_METHOD.CONTEXT_CLEAR_PREVIEW, {});
  assert.deepEqual(after.size, preview.size);
  assert.notEqual(after.previewToken, preview.previewToken);
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_CLEAR, { scope: "workspace", previewToken: preview.previewToken }), PROTOCOL_ERROR_CODES.CONFLICT);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "publicwerd" })).hits.length, 1);

  // Confirmação válida limpa só este workspace e informa tamanho anterior e posterior.
  const result = await client.callRpc(RPC_METHOD.CONTEXT_CLEAR, { scope: "workspace", previewToken: after.previewToken });
  assert.equal(result.cleared, true);
  assert.deepEqual(result.size, preview.size);
  assert.deepEqual(result.sizeAfter, { indexedFileCount: 0, chunkCount: 0, lexicalBytes: 0 });
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "publicwerd" })).hits.length, 0);
  assert.equal((await other.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 1);

  // Replay da mesma prévia após a limpeza é rejeitado.
  await expectCode(client.callRpc(RPC_METHOD.CONTEXT_CLEAR, { scope: "workspace", previewToken: after.previewToken }), PROTOCOL_ERROR_CODES.CONFLICT);
});
