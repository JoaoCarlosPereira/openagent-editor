import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { ProtocolError } from "@openagent/protocol";
import {
  createInMemorySystemSecretVault,
  createLinuxSecretServiceVault,
  createMacOsKeychainVault,
  createWindowsCredentialManagerVault,
  readProviderCredentialFromVault,
  registerProviderCredential,
} from "../../src/secrets/index.js";

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

test("[API-01] registerProviderCredential testa conexão, expõe capacidades e guarda credencial no cofre", async () => {
  const vault = createInMemorySystemSecretVault();
  const credential = "test-key-api-01";

  await withMockModelsServer(["gpt-test", "other-model"], credential, async (baseUrl) => {
    const result = await registerProviderCredential(
      {
        profileId: "local-ollama",
        endpoint: baseUrl,
        model: "gpt-test",
        credential,
      },
      { vault },
    );

    assert.match(result.secretRef, /^sysvault:memory:openagent-editor\/provider\/local-ollama$/);
    assert.equal(result.capabilities.model, "gpt-test");
    assert.deepEqual(result.capabilities.availableModels, ["gpt-test", "other-model"]);
    assert.equal(result.capabilities.supportsStreaming, true);
    assert.equal(result.capabilities.supportsChatCompletions, true);

    const stored = await readProviderCredentialFromVault(result.secretRef, vault);
    assert.deepEqual(stored, {
      credential,
      endpoint: baseUrl,
      model: "gpt-test",
    });
  });
});

test("[API-01] entrada inválida retorna INVALID_STATE sem persistir segredo", async () => {
  const vault = createInMemorySystemSecretVault();
  let probeCalls = 0;

  await assert.rejects(
    () =>
      registerProviderCredential(
        {
          profileId: "p1",
          endpoint: "not-a-url",
          model: "m",
          credential: "c",
        },
        {
          vault,
          probe: async () => {
            probeCalls += 1;
            throw new Error("probe não deveria ser chamado");
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError);
      assert.equal(err.code, "INVALID_STATE");
      return true;
    },
  );

  assert.equal(probeCalls, 0);
  const leaked = await vault.read("openagent-editor", "provider/p1");
  assert.equal(leaked, null);
});

test("[API-01] adapter Linux Secret Service persiste e recupera via secret-tool simulado", async () => {
  const store = new Map<string, string>();

  const vault = createLinuxSecretServiceVault({
    runSecretTool: async (args, input) => {
      if (args[0] === "store") {
        const service = args[args.indexOf("service") + 1];
        const account = args[args.indexOf("account") + 1];
        assert.ok(service && account);
        assert.ok(input);
        store.set(`${service}/${account}`, input);
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "lookup") {
        const service = args[args.indexOf("service") + 1];
        const account = args[args.indexOf("account") + 1];
        const value = store.get(`${service}/${account}`);
        if (!value) {
          throw Object.assign(new Error("not found"), { exitCode: 1 });
        }
        return { stdout: `${value}\n`, stderr: "" };
      }
      if (args[0] === "clear") {
        const service = args[args.indexOf("service") + 1];
        const account = args[args.indexOf("account") + 1];
        store.delete(`${service}/${account}`);
        return { stdout: "", stderr: "" };
      }
      throw new Error(`comando inesperado: ${args.join(" ")}`);
    },
  });

  await withMockModelsServer(["model-a"], "linux-secret", async (baseUrl) => {
    const result = await registerProviderCredential(
      {
        profileId: "linux-profile",
        endpoint: baseUrl,
        model: "model-a",
        credential: "linux-secret",
      },
      { vault },
    );

    assert.match(
      result.secretRef,
      /^sysvault:linux-secret-service:openagent-editor\/provider\/linux-profile$/,
    );
    const roundTrip = await readProviderCredentialFromVault(result.secretRef, vault);
    assert.equal(roundTrip?.credential, "linux-secret");
  });
});

test("[API-01] adapter macOS Keychain persiste e recupera via security simulado", async () => {
  const store = new Map<string, string>();

  const vault = createMacOsKeychainVault({
    runSecurity: async (args) => {
      const command = args[0];
      if (command === "add-generic-password") {
        const service = args[args.indexOf("-s") + 1];
        const account = args[args.indexOf("-a") + 1];
        const secret = args[args.indexOf("-w") + 1];
        assert.ok(service && account && secret);
        store.set(`${service}/${account}`, secret);
        return { stdout: "", stderr: "" };
      }
      if (command === "find-generic-password") {
        const service = args[args.indexOf("-s") + 1];
        const account = args[args.indexOf("-a") + 1];
        const value = store.get(`${service}/${account}`);
        if (!value) {
          throw Object.assign(new Error("could not be found"), { exitCode: 44 });
        }
        return { stdout: `${value}\n`, stderr: "" };
      }
      if (command === "delete-generic-password") {
        const service = args[args.indexOf("-s") + 1];
        const account = args[args.indexOf("-a") + 1];
        store.delete(`${service}/${account}`);
        return { stdout: "", stderr: "" };
      }
      throw new Error(`comando inesperado: ${args.join(" ")}`);
    },
  });

  await withMockModelsServer(["model-macos"], "macos-key", async (baseUrl) => {
    const result = await registerProviderCredential(
      {
        profileId: "macos-profile",
        endpoint: baseUrl,
        model: "model-macos",
        credential: "macos-key",
      },
      { vault },
    );

    assert.match(
      result.secretRef,
      /^sysvault:macos-keychain:openagent-editor\/provider\/macos-profile$/,
    );
    const roundTrip = await readProviderCredentialFromVault(result.secretRef, vault);
    assert.equal(roundTrip?.credential, "macos-key");
  });
});

test("[API-01] adapter Windows Credential Manager persiste e recupera via cmdkey simulado", async () => {
  const store = new Map<string, string>();

  const vault = createWindowsCredentialManagerVault({
    runCmdKey: async (args) => {
      const genericArg = args.find((a) => a.startsWith("/generic:"));
      const deleteArg = args.find((a) => a.startsWith("/delete:"));
      if (genericArg) {
        const target = genericArg.slice("/generic:".length);
        const passArg = args.find((a) => a.startsWith("/pass:"));
        assert.ok(passArg);
        store.set(target, passArg.slice("/pass:".length));
        return { stdout: "", stderr: "" };
      }
      if (deleteArg) {
        const target = deleteArg.slice("/delete:".length);
        store.delete(target);
        return { stdout: "", stderr: "" };
      }
      throw new Error(`comando inesperado: ${args.join(" ")}`);
    },
    readCredential: async (target) => store.get(target) ?? null,
  });

  await withMockModelsServer(["model-win"], "win-key", async (baseUrl) => {
    const result = await registerProviderCredential(
      {
        profileId: "win-profile",
        endpoint: baseUrl,
        model: "model-win",
        credential: "win-key",
      },
      { vault },
    );

    assert.match(
      result.secretRef,
      /^sysvault:win32-credential-manager:openagent-editor\/provider\/win-profile$/,
    );
    const roundTrip = await readProviderCredentialFromVault(result.secretRef, vault);
    assert.equal(roundTrip?.credential, "win-key");
  });
});
