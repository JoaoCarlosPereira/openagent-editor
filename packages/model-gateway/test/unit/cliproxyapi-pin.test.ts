import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createInMemorySystemSecretVault } from "@openagent/storage";

import {
  loadPinnedCliProxyApiSidecar,
  registerCliProxyProviderProfile,
  resolveCliProxyArtifactForPlatform,
  verifyCliProxyArchiveChecksum,
} from "../../src/index.js";

test("[API-01] pin CLIProxyAPI v8.0.45 expõe checksums por SO/arquitetura e SBOM", async () => {
  const pin = await loadPinnedCliProxyApiSidecar();
  assert.equal(pin.manifest.version, "8.0.45");
  assert.equal(pin.manifest.gitCommitShort, "ad8bdd3");
  assert.match(pin.manifest.gitCommit, /^ad8bdd3/);
  assert.equal(pin.sbom.bomFormat, "CycloneDX");
  assert.equal(pin.sbom.metadata?.component?.version, "8.0.45");
  assert.equal(pin.provenanceModule, "packaging/sidecars/cliproxyapi");

  const linuxAmd = resolveCliProxyArtifactForPlatform(pin.manifest, {
    os: "linux",
    arch: "amd64",
  });
  assert.equal(linuxAmd.archiveFileName, "CLIProxyAPI_8.0.45_linux_amd64.tar.gz");
  assert.equal(linuxAmd.sha256.length, 64);

  const dir = mkdtempSync(join(tmpdir(), "cliproxy-checksum-"));
  const archivePath = join(dir, linuxAmd.archiveFileName);
  writeFileSync(archivePath, "fixture-bytes");
  assert.throws(
    () =>
      verifyCliProxyArchiveChecksum(pin.manifest, archivePath, { os: "linux", arch: "amd64" }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});

test("[API-01] registerCliProxyProviderProfile testa conexão, capacidades e cofre com endpoint do pin", async () => {
  const pin = await loadPinnedCliProxyApiSidecar();
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

  let probedEndpoint = "";
  const result = await registerCliProxyProviderProfile(
    database,
    {
      profileId: "cliproxy-local",
      model: "gpt-test",
      credential: "secret-token",
    },
    {
      vault,
      probe: async (input) => {
        probedEndpoint = input.endpoint;
        return {
          endpoint: input.endpoint,
          model: input.model,
          availableModels: ["gpt-test"],
          supportsStreaming: true,
          supportsChatCompletions: true,
        };
      },
    },
  );

  assert.equal(probedEndpoint, pin.manifest.defaultOpenAiBaseUrl);
  assert.equal(result.capabilities.model, "gpt-test");
  assert.match(result.profile.secretRef, /cliproxy-local/);
  assert.equal(result.profile.endpoint, pin.manifest.defaultOpenAiBaseUrl);
});

test("[API-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
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

  let probeCalls = 0;
  await assert.rejects(
    () =>
      registerCliProxyProviderProfile(
        database,
        {
          profileId: "   ",
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
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
  assert.equal(probeCalls, 0);
});
