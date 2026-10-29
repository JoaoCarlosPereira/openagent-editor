import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { connectHarnessClient, PROTOCOL_ERROR_CODES, ProtocolError, RPC_METHOD } from "@openagent/protocol";
import { startHarnessDaemon } from "../../../../services/harness-daemon/src/index.js";
import { SettingsController, buildSettingsView, createSettingsRpcPort } from "../../src/settings/index.js";

test("Settings integra exclusões e prévia com daemon e SQLite reais", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "settings-rpc-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, "project");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "secret.txt"), "secretword");
  await writeFile(path.join(workspaceRoot, "public.txt"), "publicword");
  const daemon = await startHarnessDaemon({ dataRoot: root, runtimeDirectory: path.join(root, "runtime") });
  t.after(async () => daemon.stop());
  const client = await connectHarnessClient({
    address: daemon.address,
    workspaceHello: {
      type: "workspace.hello", workspaceId: "settings-real", workspaceRoot,
      providerProfileId: "default", mode: "agent", rulesRef: "default",
      mcpServerIds: [], sessionIds: [],
    },
  });
  t.after(() => client.close());
  const settings = new SettingsController(createSettingsRpcPort(client, {
    async testAndSaveProvider() { throw new Error("não usado"); },
  }));
  const secondRoot = path.join(root, "second");
  await mkdir(secondRoot);
  await writeFile(path.join(secondRoot, "other.txt"), "otherword");
  const second = await connectHarnessClient({
    address: daemon.address,
    workspaceHello: {
      type: "workspace.hello", workspaceId: "settings-second", workspaceRoot: secondRoot,
      providerProfileId: "default", mode: "agent", rulesRef: "default",
      mcpServerIds: [], sessionIds: [],
    },
  });
  t.after(() => second.close());
  await second.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["other.txt"] });
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["secret.txt", "public.txt"] });
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 1);
  await settings.setExclusionPatterns(["secret.txt"]);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "secretword" })).hits.length, 0);
  const attach = await client.callRpc(RPC_METHOD.CONTEXT_ATTACH, { attachments: [
    { id: "secret", kind: "file", path: path.join(workspaceRoot, "secret.txt"), previewText: "secretword" },
    { id: "public", kind: "file", path: path.join(workspaceRoot, "public.txt"), previewText: "publicword" },
  ] });
  assert.deepEqual(attach.sources.map((source) => source.id), ["public"]);
  await settings.describeIndexSize();
  const before = settings.snapshot.indexSizeSnapshot;
  assert.equal(before?.indexedFileCount, 1);
  const view = buildSettingsView({
    endpoint: "", model: "", hasCredential: false, capabilities: null, secretRef: null,
    contextLimitTokens: null, errorMessage: null, indexSizeSnapshot: before,
  });
  assert.match(view.html, /Arquivos: 1/);
  await assert.rejects(settings.clearIndex(false), ProtocolError);
  // Cancelamento não altera dados: o índice segue consultável.
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "publicword" })).hits.length, 1);
  await writeFile(path.join(workspaceRoot, "public.txt"), "anotherword");
  await client.callRpc(RPC_METHOD.CONTEXT_INDEX, { paths: ["public.txt"] });
  await assert.rejects(settings.clearIndex(true), (error: unknown) =>
    error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.CONFLICT);
  await settings.describeIndexSize();
  await settings.clearIndex(true);
  assert.equal((await client.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "anotherword" })).hits.length, 0);
  assert.equal((await second.callRpc(RPC_METHOD.CONTEXT_SEARCH, { query: "otherword" })).hits.length, 1);
  assert.deepEqual((await client.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns, ["secret.txt"]);
  const reconnected = await connectHarnessClient({
    address: daemon.address,
    workspaceHello: {
      type: "workspace.hello", workspaceId: "settings-real", workspaceRoot,
      providerProfileId: "default", mode: "agent", rulesRef: "default",
      mcpServerIds: [], sessionIds: [],
    },
  });
  t.after(() => reconnected.close());
  assert.deepEqual((await reconnected.callRpc(RPC_METHOD.CONTEXT_EXCLUSIONS_GET, {})).patterns, ["secret.txt"]);
});
