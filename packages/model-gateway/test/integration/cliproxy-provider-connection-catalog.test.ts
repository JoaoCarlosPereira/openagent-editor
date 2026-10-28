import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createInMemorySystemSecretVault, readProviderCredentialFromVault } from "@openagent/storage";

import {
  catalogCliProxyProviderCapabilities,
  registerCliProxyProviderProfile,
} from "../../src/index.js";

async function withMockOpenAiModelsServer(
  models: string[],
  expectedBearer: string,
  run: (openAiBaseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
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
  const openAiBaseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    await run(openAiBaseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("[API-01] catalogCliProxyProviderCapabilities testa conexão e expõe catálogo com pin CLIProxyAPI", async () => {
  const credential = "catalog-token-api-01";

  await withMockOpenAiModelsServer(["gpt-test", "other-model"], credential, async (openAiBaseUrl) => {
    const catalog = await catalogCliProxyProviderCapabilities({
      endpoint: openAiBaseUrl,
      model: "gpt-test",
      credential,
    });

    assert.equal(catalog.model, "gpt-test");
    assert.deepEqual(catalog.availableModels, ["gpt-test", "other-model"]);
    assert.equal(catalog.supportsStreaming, true);
    assert.equal(catalog.supportsChatCompletions, true);
    assert.equal(catalog.sidecar.component, "CLIProxyAPI");
    assert.equal(catalog.sidecar.version, "8.0.45");
    assert.equal(catalog.sidecar.gitCommitShort, "ad8bdd3");
    assert.deepEqual(catalog.compatibleRoutes, ["models", "chat.completions"]);
    assert.equal(catalog.endpoint, openAiBaseUrl);
  });
});

test("[API-01] registerCliProxyProviderProfile testa conexão, capacidades e cofre via catálogo real", async () => {
  const vault = createInMemorySystemSecretVault();
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE provider_profile (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      secret_ref TEXT NOT NULL
    );
  `);
  const credential = "register-token-api-01";

  await withMockOpenAiModelsServer(["gpt-test"], credential, async (openAiBaseUrl) => {
    const result = await registerCliProxyProviderProfile(
      database,
      {
        profileId: "cliproxy-catalog",
        model: "gpt-test",
        credential,
        endpoint: openAiBaseUrl,
      },
      { vault },
    );

    assert.equal(result.capabilities.model, "gpt-test");
    assert.deepEqual(result.capabilities.availableModels, ["gpt-test"]);
    assert.equal(result.profile.endpoint, openAiBaseUrl);

    const stored = await readProviderCredentialFromVault(result.profile.secretRef, vault);
    assert.deepEqual(stored, {
      credential,
      endpoint: openAiBaseUrl,
      model: "gpt-test",
    });
  });
});

test("[API-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const credential = "err-token";

  await assert.rejects(
    () =>
      catalogCliProxyProviderCapabilities({
        endpoint: "not-a-url",
        model: "m",
        credential: "c",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  await withMockOpenAiModelsServer(["listed-only"], credential, async (openAiBaseUrl) => {
    await assert.rejects(
      () =>
        catalogCliProxyProviderCapabilities({
          endpoint: openAiBaseUrl,
          model: "missing-model",
          credential,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  });
});
