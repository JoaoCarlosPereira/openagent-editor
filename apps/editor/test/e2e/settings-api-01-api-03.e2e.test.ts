import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  SettingsController,
  buildSettingsView,
  type SettingsProviderPort,
} from "../../src/settings/index.js";

describe("Settings API-01/API-03 e2e — capacidades e teto de contexto", () => {
  it("testa provedor, expõe capacidades detectadas e confirma segredo no cofre", async () => {
    let called = 0;
    const port: SettingsProviderPort = {
      async testAndSaveProvider(input) {
        called += 1;
        assert.equal(input.endpoint, "https://api.example.test/v1");
        assert.equal(input.model, "model-x");
        assert.equal(input.credential, "secret-value");
        assert.equal(input.profileId, "profile-x");
        return {
          capabilities: {
            endpoint: input.endpoint,
            model: input.model,
            availableModels: ["model-x", "model-y"],
            supportsStreaming: true,
            supportsChatCompletions: true,
          },
          secretRef: "secret://openagent-editor/provider/profile-x",
        };
      },
    };
    const controller = new SettingsController(port);
    const notifications: unknown[] = [];
    controller.subscribe((snapshot) => notifications.push(snapshot));

    const state = await controller.testAndSaveProvider({
      endpoint: "https://api.example.test/v1/",
      model: "model-x",
      credential: "secret-value",
      profileId: "profile-x",
    });
    assert.equal(called, 1);
    assert.equal(state.detectedCapabilities?.availableModels[1], "model-y");
    assert.equal(state.savedSecretRef, "secret://openagent-editor/provider/profile-x");
    assert.equal(state.hasCredential, true);
    assert.ok(notifications.length >= 2);

    const view = buildSettingsView({
      endpoint: state.providerEndpoint ?? "",
      model: state.providerModel ?? "",
      hasCredential: state.hasCredential,
      capabilities: state.detectedCapabilities,
      secretRef: state.savedSecretRef,
      contextLimitTokens: state.contextLimitTokens,
      errorMessage: state.errorMessage,
    });
    assert.match(view.html, /data-testid="detected-capabilities"/);
    assert.match(view.html, /model-y/);
    assert.match(view.html, /Credencial salva no cofre do sistema/);
    assert.match(view.html, /data-testid="settings-context-limit-value">Teto: 200000 tokens/);
  });

  it("aplica teto padrão, persiste valor escolhido e rejeita teto inválido sem mutação", async () => {
    let persistedValue = 0;
    const port: SettingsProviderPort = {
      async testAndSaveProvider() { throw new Error("not used"); },
      async persistContextLimitTokens(value) { persistedValue = value; },
    };
    const controller = new SettingsController(port);
    assert.equal(controller.effectiveContextLimitTokens, 200_000);
    const before = controller.snapshot;
    await assert.rejects(
      controller.setContextLimitTokens(0),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(controller.snapshot.contextLimitTokens, before.contextLimitTokens);
    assert.equal(controller.effectiveContextLimitTokens, 200_000);

    await controller.setContextLimitTokens(48_000);
    assert.equal(persistedValue, 48_000);
    assert.equal(controller.effectiveContextLimitTokens, 48_000);
    const persisted = new SettingsController(undefined, {
      contextLimitTokens: controller.snapshot.contextLimitTokens,
    });
    assert.equal(persisted.effectiveContextLimitTokens, 48_000);
    assert.match(buildSettingsView({
      endpoint: "",
      model: "",
      hasCredential: false,
      capabilities: null,
      secretRef: null,
      contextLimitTokens: persisted.snapshot.contextLimitTokens,
      errorMessage: null,
    }).html, /Teto: 48000 tokens/);
  });

  it("retorna INVALID_STATE em entrada inválida sem chamar o provedor", async () => {
    let called = false;
    const port: SettingsProviderPort = {
      async testAndSaveProvider() {
        called = true;
        throw new Error("não deveria chamar");
      },
    };
    const controller = new SettingsController(port);
    const before = controller.snapshot;
    await assert.rejects(
      controller.testAndSaveProvider({ endpoint: "file:///tmp", model: "", credential: "" }),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(called, false);
    assert.equal(controller.snapshot.providerEndpoint, before.providerEndpoint);
    assert.equal(controller.snapshot.detectedCapabilities, before.detectedCapabilities);
    assert.equal(controller.snapshot.savedSecretRef, before.savedSecretRef);
  });
});
