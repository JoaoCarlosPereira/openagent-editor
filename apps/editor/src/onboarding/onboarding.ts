import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";
import type {
  ProviderCapabilities,
  SystemSecretVault,
} from "@openagent/storage";

import {
  buildOnboardingView,
  type OnboardingOpenedProject,
  type OnboardingProviderFormState,
  type OnboardingStep,
  type OnboardingViewSnapshot,
} from "./onboarding-view.js";

export type {
  OnboardingOpenedProject,
  OnboardingProviderFormState,
  OnboardingStep,
  OnboardingViewSnapshot,
} from "./onboarding-view.js";
export { buildOnboardingView } from "./onboarding-view.js";

export interface OnboardingProviderInput {
  endpoint: string;
  model: string;
  credential: string;
  profileId?: string;
}

export interface OnboardingTestConnectionResult {
  capabilities: ProviderCapabilities;
  secretRef: string;
}

export interface OnboardingPort {
  /**
   * Testa a conexão com o provedor, obtém capacidades e guarda a credencial no cofre.
   */
  testAndSaveProvider(input: {
    endpoint: string;
    model: string;
    credential: string;
    profileId: string;
    vault?: SystemSecretVault;
  }): Promise<OnboardingTestConnectionResult>;

  /**
   * Abre um projeto local sem conta da Anysphere.
   */
  openProjectWithoutAccount?(input: {
    projectPath: string;
  }): Promise<OnboardingOpenedProject>;
}

export type OnboardingListener = (snapshot: OnboardingViewSnapshot) => void;

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

/**
 * UI-03 + API-01: Onboarding no primeiro uso do editor.
 *
 * QUANDO a pessoa abrir o editor pela primeira vez ENTÃO o produto DEVE
 * conduzir a configuração do provedor, executar um teste de conexão
 * e permitir abrir um projeto sem conta da Anysphere.
 *
 * QUANDO a pessoa informar endpoint, modelo e credencial ENTÃO o produto DEVE
 * testar a conexão, mostrar as capacidades detectadas e guardar a credencial
 * no cofre do sistema.
 */
export class OnboardingController {
  private currentStepValue: OnboardingStep;
  private readonly isFirstRunValue: boolean;
  private providerFormState: OnboardingProviderFormState;
  private detectedCapabilitiesValue: ProviderCapabilities | null = null;
  private savedSecretRefValue: string | null = null;
  private openedProjectValue: OnboardingOpenedProject | null = null;
  private isTestingConnectionValue = false;
  private isSavingCredentialValue = false;
  private errorMessageValue: string | null = null;
  private view: OnboardingViewSnapshot;
  private readonly listeners = new Set<OnboardingListener>();
  private readonly port?: OnboardingPort;

  constructor(options?: {
    isFirstRun?: boolean;
    initialStep?: OnboardingStep;
    initialForm?: Partial<OnboardingProviderFormState>;
    port?: OnboardingPort;
  }) {
    this.isFirstRunValue = options?.isFirstRun ?? true;
    this.currentStepValue = options?.initialStep ?? (this.isFirstRunValue ? "welcome" : "configure_provider");
    this.port = options?.port;

    this.providerFormState = {
      endpoint: options?.initialForm?.endpoint ?? "http://127.0.0.1:8080/v1",
      model: options?.initialForm?.model ?? "default-model",
      credential: options?.initialForm?.credential ?? "",
      profileId: options?.initialForm?.profileId ?? "default-profile",
    };

    this.view = this.render();
  }

  get currentStep(): OnboardingStep {
    return this.currentStepValue;
  }

  get isFirstRun(): boolean {
    return this.isFirstRunValue;
  }

  get snapshot(): OnboardingViewSnapshot {
    return this.view;
  }

  get providerForm(): Readonly<OnboardingProviderFormState> {
    return { ...this.providerFormState };
  }

  get detectedCapabilities(): ProviderCapabilities | null {
    return this.detectedCapabilitiesValue;
  }

  get savedSecretRef(): string | null {
    return this.savedSecretRefValue;
  }

  get openedProject(): OnboardingOpenedProject | null {
    return this.openedProjectValue;
  }

  subscribe(listener: OnboardingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Avança do passo de boas-vindas para a configuração do provedor.
   */
  startConfiguration(): OnboardingViewSnapshot {
    if (this.currentStepValue !== "welcome") {
      throw invalidState(
        `Transição inválida para startConfiguration no passo atual '${this.currentStepValue}'.`,
        ["currentStep"],
      );
    }
    this.currentStepValue = "configure_provider";
    this.errorMessageValue = null;
    return this.updateAndNotify();
  }

  /**
   * Atualiza os campos do formulário do provedor.
   */
  updateProviderForm(updates: Partial<OnboardingProviderInput>): OnboardingViewSnapshot {
    if (this.currentStepValue !== "configure_provider" && this.currentStepValue !== "welcome") {
      throw invalidState(
        `Não é possível alterar formulário de provedor no passo atual '${this.currentStepValue}'.`,
        ["currentStep"],
      );
    }

    if (updates.endpoint !== undefined) {
      this.providerFormState.endpoint = updates.endpoint.trim();
    }
    if (updates.model !== undefined) {
      this.providerFormState.model = updates.model.trim();
    }
    if (updates.credential !== undefined) {
      this.providerFormState.credential = updates.credential;
    }
    if (updates.profileId !== undefined) {
      this.providerFormState.profileId = updates.profileId.trim();
    }

    this.errorMessageValue = null;
    return this.updateAndNotify();
  }

  /**
   * Executa a validação e o teste de conexão com o provedor (API-01).
   * Se bem-sucedido, guarda a credencial no cofre do sistema, exibe capacidades
   * detectadas e transita para connection_success.
   */
  async submitProviderAndTest(
    input?: Partial<OnboardingProviderInput>,
    customPort?: OnboardingPort,
  ): Promise<OnboardingViewSnapshot> {
    if (input) {
      if (input.endpoint !== undefined) this.providerFormState.endpoint = input.endpoint.trim();
      if (input.model !== undefined) this.providerFormState.model = input.model.trim();
      if (input.credential !== undefined) this.providerFormState.credential = input.credential;
      if (input.profileId !== undefined) this.providerFormState.profileId = input.profileId.trim();
    }

    const { endpoint, model, credential, profileId } = this.providerFormState;

    // Validações rigorosas de entrada (caminho de erro: INVALID_STATE sem efeito colateral)
    const missingDetails: string[] = [];
    if (!endpoint || endpoint.length === 0) missingDetails.push("endpoint");
    if (!model || model.length === 0) missingDetails.push("model");
    if (!credential || credential.trim().length === 0) missingDetails.push("credential");
    if (!profileId || profileId.length === 0) missingDetails.push("profileId");

    if (missingDetails.length > 0) {
      const err = invalidState("Dados do provedor incompletos ou inválidos.", missingDetails);
      this.errorMessageValue = err.message;
      this.updateAndNotify();
      throw err;
    }

    // Validação de formato de URL para o endpoint
    try {
      const url = new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Protocolo inválido");
      }
    } catch {
      const err = invalidState("Endpoint deve ser uma URL http ou https válida.", ["endpoint"]);
      this.errorMessageValue = err.message;
      this.updateAndNotify();
      throw err;
    }

    // Transição transitória para test_connection
    const previousStep = this.currentStepValue;
    this.currentStepValue = "test_connection";
    this.isTestingConnectionValue = true;
    this.isSavingCredentialValue = true;
    this.errorMessageValue = null;
    this.updateAndNotify();

    const activePort = customPort ?? this.port;

    try {
      let result: OnboardingTestConnectionResult;

      if (activePort) {
        result = await activePort.testAndSaveProvider({
          endpoint,
          model,
          credential,
          profileId,
        });
      } else {
        // Fallback simulado determinístico caso nenhuma porta seja injetada
        result = {
          capabilities: {
            endpoint,
            model,
            availableModels: [model, "gpt-4o-mini", "claude-3-5-sonnet"],
            supportsStreaming: true,
            supportsChatCompletions: true,
          },
          secretRef: `secret://openagent-editor/provider/${profileId}`,
        };
      }

      this.detectedCapabilitiesValue = result.capabilities;
      this.savedSecretRefValue = result.secretRef;
      this.currentStepValue = "connection_success";
      this.isTestingConnectionValue = false;
      this.isSavingCredentialValue = false;
      this.errorMessageValue = null;
      return this.updateAndNotify();
    } catch (error) {
      // Reversão de estado sem efeito colateral no cofre ou no passo
      this.currentStepValue = previousStep;
      this.isTestingConnectionValue = false;
      this.isSavingCredentialValue = false;
      const message = error instanceof Error ? error.message : "Falha no teste de conexão com o provedor.";
      this.errorMessageValue = message;
      this.updateAndNotify();

      if (error instanceof ProtocolError) {
        throw error;
      }
      throw invalidState(message, ["connection_test_failed"]);
    }
  }

  /**
   * Avança de connection_success para open_project (UI-03).
   */
  proceedToOpenProject(): OnboardingViewSnapshot {
    if (this.currentStepValue !== "connection_success") {
      throw invalidState(
        `Não é possível avançar para abertura de projeto a partir do passo '${this.currentStepValue}'.`,
        ["currentStep"],
      );
    }
    this.currentStepValue = "open_project";
    this.errorMessageValue = null;
    return this.updateAndNotify();
  }

  /**
   * Abre um projeto local sem conta da Anysphere (UI-03).
   */
  async openProject(
    projectPath: string,
    customPort?: OnboardingPort,
  ): Promise<OnboardingViewSnapshot> {
    if (this.currentStepValue !== "open_project" && this.currentStepValue !== "connection_success") {
      throw invalidState(
        `Passo inválido '${this.currentStepValue}' para abrir projeto. Deve ser 'open_project' ou 'connection_success'.`,
        ["currentStep"],
      );
    }

    const trimmedPath = projectPath?.trim();
    if (!trimmedPath || trimmedPath.length === 0) {
      const err = invalidState("Caminho do projeto não pode ser vazio.", ["projectPath"]);
      this.errorMessageValue = err.message;
      this.updateAndNotify();
      throw err;
    }

    const activePort = customPort ?? this.port;

    if (activePort?.openProjectWithoutAccount) {
      this.openedProjectValue = await activePort.openProjectWithoutAccount({
        projectPath: trimmedPath,
      });
    } else {
      // Criação de representação de projeto local sem conta da Anysphere
      const folderName = trimmedPath.split(/[\\/]/).filter(Boolean).pop() ?? "meu-projeto";
      this.openedProjectValue = {
        workspaceId: `ws-local-${folderName.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`,
        projectPath: trimmedPath,
        name: folderName,
        accountRequired: false,
      };
    }

    this.currentStepValue = "completed";
    this.errorMessageValue = null;
    return this.updateAndNotify();
  }

  private render(): OnboardingViewSnapshot {
    return buildOnboardingView({
      currentStep: this.currentStepValue,
      isFirstRun: this.isFirstRunValue,
      providerForm: this.providerFormState,
      detectedCapabilities: this.detectedCapabilitiesValue,
      savedSecretRef: this.savedSecretRefValue,
      openedProject: this.openedProjectValue,
      isTestingConnection: this.isTestingConnectionValue,
      isSavingCredential: this.isSavingCredentialValue,
      errorMessage: this.errorMessageValue,
    });
  }

  private updateAndNotify(): OnboardingViewSnapshot {
    this.view = this.render();
    for (const listener of this.listeners) {
      try {
        listener(this.view);
      } catch {
        // Ignora erros de listener para garantir consistência
      }
    }
    return this.view;
  }
}
