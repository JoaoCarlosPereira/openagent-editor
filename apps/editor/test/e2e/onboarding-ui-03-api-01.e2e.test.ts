import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  OnboardingController,
  type OnboardingPort,
  type OnboardingViewSnapshot,
} from "../../src/onboarding/index.js";

describe("UI-03 & API-01 e2e — Onboarding: provedor, teste de conexão e projeto sem conta", () => {
  it("[UI-03] conduz a configuração do provedor, executa teste de conexão e permite abrir projeto sem conta Anysphere", async () => {
    let testCalled = false;
    let openProjectCalled = false;

    const mockPort: OnboardingPort = {
      async testAndSaveProvider(input) {
        testCalled = true;
        assert.equal(input.endpoint, "http://127.0.0.1:11434/v1");
        assert.equal(input.model, "llama3:latest");
        assert.equal(input.credential, "secret-key-ollama");
        assert.equal(input.profileId, "ollama-local");

        return {
          capabilities: {
            endpoint: input.endpoint,
            model: input.model,
            availableModels: ["llama3:latest", "mistral:latest", "qwen2.5-coder"],
            supportsStreaming: true,
            supportsChatCompletions: true,
          },
          secretRef: `secret://openagent-editor/provider/${input.profileId}`,
        };
      },

      async openProjectWithoutAccount(input) {
        openProjectCalled = true;
        assert.equal(input.projectPath, "/home/user/meu-novo-projeto");
        return {
          workspaceId: "ws-local-meu-novo-projeto",
          projectPath: input.projectPath,
          name: "meu-novo-projeto",
          accountRequired: false,
        };
      },
    };

    // 1. Instanciação inicial: primeiro uso do editor (isFirstRun = true)
    const controller = new OnboardingController({
      isFirstRun: true,
      port: mockPort,
    });

    assert.equal(controller.isFirstRun, true);
    assert.equal(controller.currentStep, "welcome");
    assert.equal(controller.snapshot.accessible.currentStep, "welcome");
    assert.equal(controller.snapshot.accessible.anysphereAccountRequired, false);

    // Efeito observável no HTML inicial
    assert.match(controller.snapshot.html, /data-testid="onboarding-step-welcome"/);
    assert.match(controller.snapshot.html, /data-anysphere-required="false"/);
    assert.match(controller.snapshot.html, /Sem conta da Anysphere necessária/);
    assert.match(controller.snapshot.html, /data-testid="start-onboarding-button"/);

    // Observador reativo
    const observerSnapshots: OnboardingViewSnapshot[] = [];
    const unsubscribe = controller.subscribe((snapshot) => {
      observerSnapshots.push(snapshot);
    });

    // 2. Passo: iniciar configuração do provedor
    const configureSnapshot = controller.startConfiguration();
    assert.equal(controller.currentStep, "configure_provider");
    assert.equal(configureSnapshot.accessible.currentStep, "configure_provider");
    assert.match(configureSnapshot.html, /data-testid="onboarding-provider-form"/);
    assert.match(configureSnapshot.html, /data-testid="test-connection-button"/);

    // 3. Passo: preenchimento e teste de conexão (API-01)
    const successSnapshot = await controller.submitProviderAndTest({
      endpoint: "http://127.0.0.1:11434/v1",
      model: "llama3:latest",
      credential: "secret-key-ollama",
      profileId: "ollama-local",
    });

    assert.equal(testCalled, true);
    assert.equal(controller.currentStep, "connection_success");
    assert.equal(successSnapshot.accessible.currentStep, "connection_success");
    assert.notEqual(controller.detectedCapabilities, null);
    assert.equal(controller.detectedCapabilities?.supportsStreaming, true);
    assert.equal(controller.detectedCapabilities?.supportsChatCompletions, true);
    assert.equal(controller.savedSecretRef, "secret://openagent-editor/provider/ollama-local");

    // Efeito observável: capacidades detectadas e cofre do sistema
    assert.match(successSnapshot.html, /data-testid="onboarding-step-success"/);
    assert.match(successSnapshot.html, /Capacidades Detectadas \(API-01\)/);
    assert.match(successSnapshot.html, /data-testid="detected-capabilities-section"/);
    assert.match(successSnapshot.html, /llama3:latest/);
    assert.match(successSnapshot.html, /qwen2.5-coder/);
    assert.match(successSnapshot.html, /data-testid="vault-stored-status"/);
    assert.match(successSnapshot.html, /secret:\/\/openagent-editor\/provider\/ollama-local/);

    // 4. Passo: avançar para abertura de projeto sem conta Anysphere
    const openProjectStepSnapshot = controller.proceedToOpenProject();
    assert.equal(controller.currentStep, "open_project");
    assert.equal(openProjectStepSnapshot.accessible.currentStep, "open_project");
    assert.match(openProjectStepSnapshot.html, /data-testid="onboarding-step-open-project"/);
    assert.match(openProjectStepSnapshot.html, /sem necessidade de login ou conta da Anysphere/);
    assert.match(openProjectStepSnapshot.html, /data-testid="open-project-button"/);

    // 5. Passo: abrir projeto local
    const completedSnapshot = await controller.openProject("/home/user/meu-novo-projeto");
    assert.equal(openProjectCalled, true);
    assert.equal(controller.currentStep, "completed");
    assert.equal(completedSnapshot.accessible.currentStep, "completed");
    assert.notEqual(controller.openedProject, null);
    assert.equal(controller.openedProject?.name, "meu-novo-projeto");
    assert.equal(controller.openedProject?.accountRequired, false);

    // Efeito observável da conclusão sem conta
    assert.match(completedSnapshot.html, /data-testid="onboarding-step-completed"/);
    assert.match(completedSnapshot.html, /sem conta da Anysphere/);
    assert.match(completedSnapshot.html, /meu-novo-projeto/);

    // Observer notificou todas as transições
    assert.ok(observerSnapshots.length >= 4);
    unsubscribe();
  });

  it("[API-01] testa conexão com endpoint personalizado, exibe catálogo e guarda credencial no cofre", async () => {
    let storedSecret = false;

    const controller = new OnboardingController({
      isFirstRun: false,
      initialStep: "configure_provider",
      port: {
        async testAndSaveProvider(input) {
          storedSecret = true;
          return {
            capabilities: {
              endpoint: input.endpoint,
              model: input.model,
              availableModels: [input.model, "custom-model-2"],
              supportsStreaming: true,
              supportsChatCompletions: true,
            },
            secretRef: `secret://openagent-editor/provider/${input.profileId}`,
          };
        },
      },
    });

    const snapshot = await controller.submitProviderAndTest({
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o",
      credential: "sk-proj-testkey12345678",
      profileId: "openai-prod",
    });

    assert.equal(storedSecret, true);
    assert.equal(snapshot.accessible.detectedCapabilities?.endpoint, "https://api.openai.com/v1");
    assert.equal(snapshot.accessible.detectedCapabilities?.model, "gpt-4o");
    assert.equal(snapshot.accessible.savedSecretRef, "secret://openagent-editor/provider/openai-prod");
    assert.match(snapshot.html, /data-testid="cap-streaming"/);
    assert.match(snapshot.html, /data-testid="cap-chat"/);
    assert.match(snapshot.html, /data-testid="system-vault-section"/);
  });

  it("[UI-03] caminho de erro: validações de entrada e estado inválido retornam INVALID_STATE sem efeito colateral", async () => {
    const controller = new OnboardingController({
      isFirstRun: true,
      initialStep: "welcome",
    });

    // 1. Tentar configurar provedor antes de iniciar -> INVALID_STATE
    assert.throws(
      () => {
        controller.proceedToOpenProject();
      },
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.equal(controller.currentStep, "welcome");

    controller.startConfiguration();
    assert.equal(controller.currentStep, "configure_provider");

    // 2. Submeter com credencial vazia -> INVALID_STATE
    await assert.rejects(
      async () => {
        await controller.submitProviderAndTest({
          endpoint: "http://127.0.0.1:8080/v1",
          model: "teste",
          credential: "", // Inválido / vazio
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.ok((err.details as string[]).includes("credential"));
        return true;
      },
    );
    // Estado preservado em configure_provider sem avançar
    assert.equal(controller.currentStep, "configure_provider");
    assert.equal(controller.detectedCapabilities, null);
    assert.equal(controller.savedSecretRef, null);

    // 3. Submeter com endpoint de protocolo inválido -> INVALID_STATE
    await assert.rejects(
      async () => {
        await controller.submitProviderAndTest({
          endpoint: "ftp://servidor-invalido/v1",
          model: "teste",
          credential: "valid-key",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.ok((err.details as string[]).includes("endpoint"));
        return true;
      },
    );
    assert.equal(controller.currentStep, "configure_provider");

    // 4. Falha na porta durante o teste de conexão -> reverte para configure_provider e propaga erro
    const failingController = new OnboardingController({
      initialStep: "configure_provider",
      port: {
        async testAndSaveProvider() {
          throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, "Falha de conexão: servidor recusou.");
        },
      },
    });

    await assert.rejects(
      async () => {
        await failingController.submitProviderAndTest({
          endpoint: "http://127.0.0.1:9999/v1",
          model: "teste",
          credential: "valid-key",
          profileId: "fail-test",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.equal(failingController.currentStep, "configure_provider");
    assert.equal(failingController.detectedCapabilities, null);
    assert.equal(failingController.savedSecretRef, null);
    assert.match(failingController.snapshot.html, /data-testid="onboarding-error"/);

    // 5. Tentar abrir projeto com caminho vazio -> INVALID_STATE
    failingController.proceedToOpenProject = () => {
      // Simula avanço para teste de caminho vazio
      failingController["currentStepValue"] = "open_project";
      return failingController.snapshot;
    };
    failingController.proceedToOpenProject();

    await assert.rejects(
      async () => {
        await failingController.openProject("   ");
      },
      (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        assert.ok((err.details as string[]).includes("projectPath"));
        return true;
      },
    );
    assert.equal(failingController.openedProject, null);
  });
});
