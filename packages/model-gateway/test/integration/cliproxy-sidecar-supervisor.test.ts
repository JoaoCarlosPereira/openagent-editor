import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createInMemorySystemSecretVault } from "@openagent/storage";

import {
  checkCliProxySidecarHealth,
  registerSupervisedCliProxyProviderProfile,
  shutdownCliProxySidecarSupervised,
  startCliProxySidecarSupervised,
  type SidecarProcessSpawnInput,
} from "../../src/index.js";

const fakeSidecarScript = fileURLToPath(
  new URL("../fixtures/fake-cliproxy-sidecar.mjs", import.meta.url),
);

function spawnFakeSidecar(input: SidecarProcessSpawnInput) {
  return spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function buildFakeSidecarLaunch(context: {
  configPath: string;
  port: number;
  secrets: { accessToken: string; managementSecret: string };
  runtimeDirectory: string;
}) {
  return {
    command: process.execPath,
    args: [fakeSidecarScript],
    cwd: context.runtimeDirectory,
    env: {
      ...process.env,
      OPENAGENT_CLIPROXY_PORT: String(context.port),
      OPENAGENT_CLIPROXY_ACCESS_TOKEN: context.secrets.accessToken,
      OPENAGENT_CLIPROXY_MANAGEMENT_SECRET: context.secrets.managementSecret,
    },
  };
}

test("[API-01] supervisor do sidecar: bind loopback, token efêmero, health check e shutdown", async () => {
  const sidecar = await startCliProxySidecarSupervised({
    buildLaunchSpec: buildFakeSidecarLaunch,
    spawnProcess: spawnFakeSidecar,
  });

  assert.equal(sidecar.host, "127.0.0.1");
  assert.ok(sidecar.port > 0);
  assert.match(sidecar.openAiBaseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.ok(sidecar.secrets.accessToken.length >= 32);
  assert.ok(fs.existsSync(sidecar.configPath));
  const configBody = fs.readFileSync(sidecar.configPath, "utf8");
  assert.match(configBody, /host: "127\.0\.0\.1"/);
  assert.match(configBody, new RegExp(`port: ${sidecar.port}`));
  assert.match(configBody, new RegExp(sidecar.secrets.accessToken));

  const health = await checkCliProxySidecarHealth({
    openAiBaseUrl: sidecar.openAiBaseUrl,
    accessToken: sidecar.secrets.accessToken,
  });
  assert.equal(health.ok, true);
  assert.equal(health.modelCount, 2);

  const exitPromise = once(sidecar.child, "exit");
  await shutdownCliProxySidecarSupervised(sidecar);
  assert.equal(fs.existsSync(sidecar.configPath), false);
  const [exitCode] = await exitPromise;
  assert.equal(exitCode, 0);
});

test("[API-01] registerSupervisedCliProxyProviderProfile testa conexão, capacidades e cofre via sidecar local", async () => {
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

  const { sidecar, registration } = await registerSupervisedCliProxyProviderProfile(
    database,
    {
      profileId: "cliproxy-supervised",
      model: "gpt-test",
    },
    {
      vault,
      sidecar: {
        buildLaunchSpec: buildFakeSidecarLaunch,
        spawnProcess: spawnFakeSidecar,
      },
    },
  );

  try {
    assert.equal(registration.capabilities.model, "gpt-test");
    assert.deepEqual(registration.capabilities.availableModels, ["gpt-test", "other-model"]);
    assert.equal(registration.profile.endpoint, sidecar.openAiBaseUrl);
    assert.match(registration.profile.secretRef, /cliproxy-supervised/);
  } finally {
    await shutdownCliProxySidecarSupervised(sidecar);
  }
});

test("[API-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", async () => {
  const tmpDir = os.tmpdir();
  const cliproxyDirsBefore = new Set(
    fs.readdirSync(tmpDir).filter((name) => name.startsWith("openagent-cliproxy-")),
  );

  await assert.rejects(
    () => startCliProxySidecarSupervised({}),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  const cliproxyDirsAfter = fs
    .readdirSync(tmpDir)
    .filter((name) => name.startsWith("openagent-cliproxy-"));
  const newDirs = cliproxyDirsAfter.filter((name) => !cliproxyDirsBefore.has(name));
  assert.equal(
    newDirs.length,
    0,
    "startCliProxySidecarSupervised({}) não deve criar diretório efêmero com segredos",
  );
  for (const dirName of cliproxyDirsAfter) {
    const configPath = path.join(tmpDir, dirName, "cliproxy-config.yaml");
    if (fs.existsSync(configPath) && !cliproxyDirsBefore.has(dirName)) {
      assert.fail(`config residual inesperado: ${configPath}`);
    }
  }
});
