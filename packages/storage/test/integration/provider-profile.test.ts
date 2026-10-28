import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ProtocolError } from "@openagent/protocol";
import {
  createInMemorySystemSecretVault,
  formatStandardLogToolAction,
  getStoredProviderProfile,
  openWorkspaceDatabase,
  providerProfileSqliteContainsPlaintext,
  readProviderCredentialFromVault,
  registerProviderProfile,
  STANDARD_LOG_REDACTED,
  STORAGE_SCHEMA_VERSION,
} from "../../src/index.js";

async function withTempDataRoot<T>(run: (dataRoot: string) => Promise<T>): Promise<T> {
  const dataRoot = await mkdtemp(join(tmpdir(), "openagent-pp-"));
  try {
    return await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

async function withMockModelsServer(
  models: string[],
  expectedBearer: string,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      if (req.headers.authorization !== `Bearer ${expectedBearer}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function seedWorkspace(database: DatabaseSync, workspaceId: string): void {
  database
    .prepare(
      `INSERT INTO workspace(id, root_path, exclusions_json, context_limit)
       VALUES (?, ?, ?, ?)`,
    )
    .run(workspaceId, "/projeto", "[]", 200_000);
}

test("[API-01] ProviderProfile com secretRef persiste no SQLite sem segredo em claro", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-provider";
    const vault = createInMemorySystemSecretVault();
    const credential = "vault-only-secret-key-33";

    const opened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(opened.databasePath);
    database.exec("PRAGMA foreign_keys = ON");
    seedWorkspace(database, workspaceId);

    await withMockModelsServer(["gpt-test"], credential, async (baseUrl) => {
      const result = await registerProviderProfile(
        database,
        {
          profileId: "local-openai",
          endpoint: baseUrl,
          model: "gpt-test",
          credential,
        },
        { vault, workspaceId },
      );

      assert.equal(result.profile.id, "local-openai");
      assert.match(result.profile.secretRef, /^sysvault:memory:/);
      assert.equal(result.capabilities.model, "gpt-test");
      assert.deepEqual(result.capabilities.availableModels, ["gpt-test"]);

      const row = getStoredProviderProfile(database, "local-openai");
      assert.ok(row);
      assert.equal(row.secretRef, result.profile.secretRef);
      assert.equal(row.endpoint, baseUrl);
      assert.equal(providerProfileSqliteContainsPlaintext(database, credential), false);

      const fromVault = await readProviderCredentialFromVault(result.profile.secretRef, vault);
      assert.deepEqual(fromVault, {
        credential,
        endpoint: baseUrl,
        model: "gpt-test",
      });

      const workspace = database
        .prepare(`SELECT provider_profile_id AS profileId FROM workspace WHERE id = ?`)
        .get(workspaceId) as { profileId: string };
      assert.equal(workspace.profileId, "local-openai");
    });

    database.close();
    opened.close();
  });
});

test("[PRV-02] log padrão de registro omite credencial e conteúdo sensível", async () => {
  const credential = "must-not-appear-in-log";
  const log = formatStandardLogToolAction({
    tool: "provider.register",
    target: "https://api.example",
    credential,
    excludedFileContent: "conteudo-excluido",
    rawModelResponseBody: '{"choices":[{"message":{"content":"segredo bruto"}}]}',
  });

  const serialized = JSON.stringify(log);
  assert.equal(log.credential, STANDARD_LOG_REDACTED);
  assert.equal(log.excludedFileContent, STANDARD_LOG_REDACTED);
  assert.equal(log.rawModelResponseBody, STANDARD_LOG_REDACTED);
  assert.equal(log.tool, "provider.register");
  assert.equal(log.target, "https://api.example");
  assert.ok(!serialized.includes(credential));
  assert.ok(!serialized.includes("conteudo-excluido"));
  assert.ok(!serialized.includes("segredo bruto"));
});

test("[API-01] entrada inválida retorna INVALID_STATE sem linha em provider_profile", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const workspaceId = "ws-invalid";
    const vault = createInMemorySystemSecretVault();
    const opened = openWorkspaceDatabase({ dataRoot, workspaceId });
    const database = new DatabaseSync(opened.databasePath);

    await assert.rejects(
      () =>
        registerProviderProfile(
          database,
          {
            profileId: "bad",
            endpoint: "not-a-url",
            model: "m",
            credential: "c",
          },
          { vault },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, "INVALID_STATE");
        return true;
      },
    );

    const count = database
      .prepare(`SELECT COUNT(*) AS n FROM provider_profile`)
      .get() as { n: number };
    assert.equal(count.n, 0);

    database.close();
    opened.close();
  });
});

test("migração 006 expõe provider_profile e schema_version 6", async () => {
  await withTempDataRoot(async (dataRoot) => {
    const db = openWorkspaceDatabase({ dataRoot, workspaceId: "ws-migrate-pp" });
    const database = new DatabaseSync(db.databasePath);
    const table = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_profile'`,
      )
      .get() as { name: string } | undefined;
    const schemaVersion = database
      .prepare(`SELECT value FROM storage_meta WHERE key = 'schema_version'`)
      .get() as { value: string };
    database.close();
    db.close();

    assert.equal(table?.name, "provider_profile");
    assert.equal(schemaVersion.value, String(STORAGE_SCHEMA_VERSION));
    assert.equal(STORAGE_SCHEMA_VERSION, 6);
  });
});
