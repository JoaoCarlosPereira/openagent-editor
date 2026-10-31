import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import { createInMemorySystemSecretVault } from "@openagent/storage";

import {
  catalogCliProxyProviderCapabilities,
  recordCliProxySidecarProcessCrash,
  registerCliProxyProviderProfile,
  restartCliProxySidecarAfterCrash,
  shutdownCliProxySidecarSupervised,
  startCliProxySidecarCrashRecoverySession,
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

test("[API-01] reinício do sidecar após crash preserva conexão, capacidades e cofre", async () => {
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

  const session = await startCliProxySidecarCrashRecoverySession({
    buildLaunchSpec: buildFakeSidecarLaunch,
    spawnProcess: spawnFakeSidecar,
  });

  try {
    const initial = await registerCliProxyProviderProfile(
      database,
      {
        profileId: "cliproxy-after-restart",
        model: "gpt-test",
        credential: session.handle.secrets.accessToken,
        endpoint: session.handle.openAiBaseUrl,
      },
      { vault },
    );
    assert.equal(initial.capabilities.model, "gpt-test");

    session.handle.child.kill("SIGKILL");
    recordCliProxySidecarProcessCrash(session.metrics);

    await restartCliProxySidecarAfterCrash(session);
    assert.equal(session.metrics.crashCount, 1);
    assert.equal(session.metrics.restartCount, 1);
    assert.ok(session.metrics.lastCrashAt);

    const rediscovered = await catalogCliProxyProviderCapabilities({
      endpoint: session.handle.openAiBaseUrl,
      model: "gpt-test",
      credential: session.handle.secrets.accessToken,
    });
    assert.deepEqual(rediscovered.availableModels, ["gpt-test", "other-model"]);

    const secondProfile = await registerCliProxyProviderProfile(
      database,
      {
        profileId: "cliproxy-post-restart",
        model: "other-model",
        credential: session.handle.secrets.accessToken,
        endpoint: session.handle.openAiBaseUrl,
      },
      { vault },
    );
    assert.equal(secondProfile.capabilities.model, "other-model");
    assert.match(secondProfile.profile.secretRef, /cliproxy-post-restart/);
  } finally {
    await shutdownCliProxySidecarSupervised(session.handle);
  }
});

test("[API-01] caminho de erro: reinício com processo vivo retorna INVALID_STATE sem efeito colateral", async () => {
  const session = await startCliProxySidecarCrashRecoverySession({
    buildLaunchSpec: buildFakeSidecarLaunch,
    spawnProcess: spawnFakeSidecar,
  });

  try {
    const before = { ...session.metrics };
    await assert.rejects(
      () => restartCliProxySidecarAfterCrash(session),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.deepEqual(session.metrics, before);
  } finally {
    await shutdownCliProxySidecarSupervised(session.handle);
  }
});
