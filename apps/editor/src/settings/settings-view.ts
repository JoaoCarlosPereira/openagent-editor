import type { ProviderCapabilities } from "@openagent/storage";
import { DEFAULT_CONTEXT_TOKEN_LIMIT } from "@openagent/context";

export interface SettingsViewInput {
  endpoint: string;
  model: string;
  hasCredential: boolean;
  capabilities: ProviderCapabilities | null;
  secretRef: string | null;
  contextLimitTokens: number | null;
  errorMessage: string | null;
}

export interface SettingsViewSnapshot {
  html: string;
  accessible: {
    endpoint: string;
    model: string;
    hasCredential: boolean;
    capabilities: ProviderCapabilities | null;
    secretRef: string | null;
    contextLimitTokens: number;
    errorMessage: string | null;
  };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Renderiza as capacidades detectadas e o teto de tokens. */
export function buildSettingsView(input: SettingsViewInput): SettingsViewSnapshot {
  const capabilities = input.capabilities;
  const capabilityHtml = capabilities
    ? [
      `<section data-testid="detected-capabilities" aria-label="Capacidades detectadas">`,
      `<h2>Capacidades detectadas</h2>`,
      `<p data-testid="capability-endpoint">Endpoint: ${escapeHtml(capabilities.endpoint)}</p>`,
      `<p data-testid="capability-model">Modelo: ${escapeHtml(capabilities.model)}</p>`,
      `<ul data-testid="capability-models">${capabilities.availableModels.map(
        (model) => `<li>${escapeHtml(model)}</li>`,
      ).join("")}</ul>`,
      `<p data-testid="capability-streaming">Streaming: ${capabilities.supportsStreaming ? "Sim" : "Não"}</p>`,
      `<p data-testid="capability-chat-completions">Chat Completions: ${capabilities.supportsChatCompletions ? "Sim" : "Não"}</p>`,
      `</section>`,
    ].join("")
    : `<p data-testid="detected-capabilities-empty">Ainda não há capacidades detectadas.</p>`;
  const contextLimit = input.contextLimitTokens ?? DEFAULT_CONTEXT_TOKEN_LIMIT;
  const errorHtml = input.errorMessage
    ? `<p role="alert" data-testid="settings-error">${escapeHtml(input.errorMessage)}</p>`
    : "";
  const html = [
    `<section data-testid="settings-panel" aria-label="Configurações">`,
    `<h1>Configurações</h1>`,
    `<form data-testid="provider-settings-form">`,
    `<label for="settings-endpoint">Endpoint</label><input id="settings-endpoint" data-testid="settings-endpoint" value="${escapeHtml(input.endpoint)}" />`,
    `<label for="settings-model">Modelo</label><input id="settings-model" data-testid="settings-model" value="${escapeHtml(input.model)}" />`,
    `<label for="settings-credential">Credencial</label><input id="settings-credential" type="password" data-testid="settings-credential" value="${input.hasCredential ? "********" : ""}" />`,
    `<button type="button" data-testid="settings-test-connection">Testar conexão</button>`,
    `</form>`,
    capabilityHtml,
    input.secretRef
      ? `<p data-testid="settings-secret-saved">Credencial salva no cofre do sistema.</p>`
      : `<p data-testid="settings-secret-not-saved">Credencial ainda não salva.</p>`,
    `<label for="settings-context-limit">Teto de contexto (tokens)</label>`,
    `<input id="settings-context-limit" type="number" min="1" step="1" data-testid="settings-context-limit" value="${contextLimit}" />`,
    `<p data-testid="settings-context-limit-value">Teto: ${contextLimit} tokens</p>`,
    errorHtml,
    `</section>`,
  ].join("");
  return {
    html,
    accessible: {
      endpoint: input.endpoint,
      model: input.model,
      hasCredential: input.hasCredential,
      capabilities,
      secretRef: input.secretRef,
      contextLimitTokens: contextLimit,
      errorMessage: input.errorMessage,
    },
  };
}
