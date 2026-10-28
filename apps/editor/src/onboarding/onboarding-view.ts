import type { ProviderCapabilities } from "@openagent/storage";

export type OnboardingStep =
  | "welcome"
  | "configure_provider"
  | "test_connection"
  | "connection_success"
  | "open_project"
  | "completed";

export interface OnboardingProviderFormState {
  endpoint: string;
  model: string;
  credential: string;
  profileId: string;
}

export interface OnboardingOpenedProject {
  workspaceId: string;
  projectPath: string;
  name: string;
  accountRequired: false;
}

export interface OnboardingViewInput {
  currentStep: OnboardingStep;
  isFirstRun: boolean;
  providerForm: OnboardingProviderFormState;
  detectedCapabilities: ProviderCapabilities | null;
  savedSecretRef: string | null;
  openedProject: OnboardingOpenedProject | null;
  isTestingConnection: boolean;
  isSavingCredential: boolean;
  errorMessage: string | null;
}

export interface OnboardingViewSnapshot {
  html: string;
  accessible: {
    currentStep: OnboardingStep;
    isFirstRun: boolean;
    providerForm: {
      endpoint: string;
      model: string;
      hasCredential: boolean;
      profileId: string;
    };
    detectedCapabilities: ProviderCapabilities | null;
    savedSecretRef: string | null;
    openedProject: OnboardingOpenedProject | null;
    isTestingConnection: boolean;
    isSavingCredential: boolean;
    errorMessage: string | null;
    anysphereAccountRequired: false;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatStepTitlePtBr(step: OnboardingStep): string {
  switch (step) {
    case "welcome":
      return "Boas-vindas ao OpenAgent Editor";
    case "configure_provider":
      return "Configuração do Provedor de Modelo";
    case "test_connection":
      return "Teste de Conexão";
    case "connection_success":
      return "Conexão Estabelecida com Sucesso";
    case "open_project":
      return "Abrir Projeto sem Conta da Anysphere";
    case "completed":
      return "Configuração Concluída";
    default:
      return step;
  }
}

export function buildOnboardingView(input: OnboardingViewInput): OnboardingViewSnapshot {
  const stepTitle = formatStepTitlePtBr(input.currentStep);
  const errorSection =
    input.errorMessage !== null
      ? `<p role="alert" aria-live="assertive" data-testid="onboarding-error">${escapeHtml(input.errorMessage)}</p>`
      : "";

  let stepContentHtml = "";

  switch (input.currentStep) {
    case "welcome":
      stepContentHtml = [
        `<div data-testid="onboarding-step-welcome">`,
        `<p>Bem-vindo ao OpenAgent Editor! Vamos configurar seu provedor de modelo local para começar.</p>`,
        `<p class="badge-no-account" data-testid="anysphere-account-badge">Sem conta da Anysphere necessária — 100% local e aberto.</p>`,
        `<button type="button" data-testid="start-onboarding-button" aria-label="Iniciar configuração">Iniciar Configuração</button>`,
        `</div>`,
      ].join("");
      break;

    case "configure_provider":
      stepContentHtml = [
        `<form data-testid="onboarding-provider-form" aria-label="Formulário de configuração do provedor">`,
        `<div>`,
        `<label for="provider-endpoint">Endpoint:</label>`,
        `<input id="provider-endpoint" name="endpoint" type="url" data-testid="provider-endpoint-input" value="${escapeHtml(input.providerForm.endpoint)}" placeholder="http://127.0.0.1:8080/v1" />`,
        `</div>`,
        `<div>`,
        `<label for="provider-model">Modelo:</label>`,
        `<input id="provider-model" name="model" type="text" data-testid="provider-model-input" value="${escapeHtml(input.providerForm.model)}" placeholder="ex: gpt-4o, claude-3-5-sonnet, llama-3" />`,
        `</div>`,
        `<div>`,
        `<label for="provider-credential">Credencial / Chave de API:</label>`,
        `<input id="provider-credential" name="credential" type="password" data-testid="provider-credential-input" value="${input.providerForm.credential ? "********" : ""}" placeholder="sk-..." />`,
        `</div>`,
        `<div>`,
        `<label for="provider-profile-id">ID do Perfil:</label>`,
        `<input id="provider-profile-id" name="profileId" type="text" data-testid="provider-profile-id-input" value="${escapeHtml(input.providerForm.profileId)}" />`,
        `</div>`,
        `<button type="button" data-testid="test-connection-button" aria-label="Testar conexão">Testar Conexão</button>`,
        `</form>`,
      ].join("");
      break;

    case "test_connection":
      stepContentHtml = [
        `<div data-testid="onboarding-step-testing" aria-live="polite">`,
        `<p role="status" data-testid="testing-status-text">Testando conexão com o provedor em ${escapeHtml(input.providerForm.endpoint)}...</p>`,
        `<div class="spinner" aria-hidden="true"></div>`,
        `</div>`,
      ].join("");
      break;

    case "connection_success": {
      const caps = input.detectedCapabilities;
      const modelsList = caps?.availableModels?.length
        ? caps.availableModels.map((m) => `<li>${escapeHtml(m)}</li>`).join("")
        : `<li>${escapeHtml(input.providerForm.model)}</li>`;

      stepContentHtml = [
        `<div data-testid="onboarding-step-success">`,
        `<p data-testid="success-message">Conexão testada e aprovada com sucesso!</p>`,
        `<section data-testid="detected-capabilities-section" aria-label="Capacidades detectadas">`,
        `<h3>Capacidades Detectadas (API-01)</h3>`,
        `<ul>`,
        `<li data-testid="cap-endpoint">Endpoint: <strong>${escapeHtml(caps?.endpoint ?? input.providerForm.endpoint)}</strong></li>`,
        `<li data-testid="cap-model">Modelo Selecionado: <strong>${escapeHtml(caps?.model ?? input.providerForm.model)}</strong></li>`,
        `<li data-testid="cap-streaming">Streaming Suportado: <strong>${caps?.supportsStreaming ? "Sim" : "Não"}</strong></li>`,
        `<li data-testid="cap-chat">Chat Completions: <strong>${caps?.supportsChatCompletions ? "Sim" : "Não"}</strong></li>`,
        `</ul>`,
        `<h4>Modelos Disponíveis</h4>`,
        `<ul data-testid="available-models-list">${modelsList}</ul>`,
        `</section>`,
        `<section data-testid="system-vault-section">`,
        `<p data-testid="vault-stored-status">Credencial armazenada com segurança no cofre do sistema (secretRef: <code>${escapeHtml(input.savedSecretRef ?? "pendente")}</code>).</p>`,
        `</section>`,
        `<button type="button" data-testid="proceed-to-project-button" aria-label="Avançar para abertura do projeto">Avançar para Abertura de Projeto</button>`,
        `</div>`,
      ].join("");
      break;
    }

    case "open_project":
      stepContentHtml = [
        `<div data-testid="onboarding-step-open-project">`,
        `<p>Você pode abrir qualquer pasta de projeto diretamente, sem necessidade de login ou conta da Anysphere.</p>`,
        `<div data-testid="open-project-form">`,
        `<label for="project-folder-path">Caminho da Pasta do Projeto:</label>`,
        `<input id="project-folder-path" type="text" data-testid="project-folder-input" placeholder="/caminho/do/seu/projeto" />`,
        `<button type="button" data-testid="open-project-button" aria-label="Abrir projeto sem conta">Abrir Projeto sem Conta</button>`,
        `</div>`,
        `</div>`,
      ].join("");
      break;

    case "completed":
      stepContentHtml = [
        `<div data-testid="onboarding-step-completed">`,
        `<p data-testid="completion-title">Onboarding concluído com sucesso!</p>`,
        input.openedProject
          ? `<p data-testid="opened-project-info">Projeto aberto: <strong>${escapeHtml(input.openedProject.name)}</strong> (workspace: ${escapeHtml(input.openedProject.workspaceId)}) sem conta da Anysphere.</p>`
          : `<p data-testid="no-project-info">Configuração de provedor concluída.</p>`,
        `<button type="button" data-testid="finish-onboarding-button" aria-label="Ir para o editor">Entrar no Editor</button>`,
        `</div>`,
      ].join("");
      break;
  }

  const html = [
    `<main data-testid="onboarding-container"`,
    ` data-current-step="${escapeHtml(input.currentStep)}"`,
    ` data-is-first-run="${input.isFirstRun ? "true" : "false"}"`,
    ` data-anysphere-required="false"`,
    ` role="region" aria-label="Onboarding do OpenAgent Editor">`,
    `<header>`,
    `<h1>OpenAgent Editor</h1>`,
    `<h2>${escapeHtml(stepTitle)}</h2>`,
    `<span data-testid="step-indicator" role="status">Passo: ${escapeHtml(input.currentStep)}</span>`,
    `</header>`,
    errorSection,
    stepContentHtml,
    `</main>`,
  ].join("");

  return {
    html,
    accessible: {
      currentStep: input.currentStep,
      isFirstRun: input.isFirstRun,
      providerForm: {
        endpoint: input.providerForm.endpoint,
        model: input.providerForm.model,
        hasCredential: input.providerForm.credential.trim().length > 0,
        profileId: input.providerForm.profileId,
      },
      detectedCapabilities: input.detectedCapabilities,
      savedSecretRef: input.savedSecretRef,
      openedProject: input.openedProject,
      isTestingConnection: input.isTestingConnection,
      isSavingCredential: input.isSavingCredential,
      errorMessage: input.errorMessage,
      anysphereAccountRequired: false,
    },
  };
}
