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
  exclusionRules?: readonly { pattern: string; source: "project-ignore" | "workspace-config"; removable: boolean }[];
  indexSizeSnapshot?: { indexedFileCount: number; chunkCount: number; lexicalBytes: number } | null;
  isClearingIndex?: boolean;
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
    exclusionRules: readonly { pattern: string; source: "project-ignore" | "workspace-config"; removable: boolean }[];
    indexSizeSnapshot: { indexedFileCount: number; chunkCount: number; lexicalBytes: number } | null;
    isClearingIndex: boolean;
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
  const rules = input.exclusionRules ?? [];
  const exclusionHtml = [
    `<section data-testid="settings-exclusions" aria-label="Regras de exclusão">`,
    `<h2>Exclusões do workspace</h2>`,
    `<p>Os caminhos excluídos não entram na indexação, no contexto automático nem na busca do agente.</p>`,
    `<ul data-testid="exclusion-rules">${rules.length ? rules.map((rule) => `<li data-source="${rule.source}">${escapeHtml(rule.pattern)} <span>${rule.source === "project-ignore" ? ".gitignore" : "Workspace"}</span>${rule.removable ? `<button type="button" data-testid="remove-exclusion" data-pattern="${escapeHtml(rule.pattern)}">Remover</button>` : ""}</li>`).join("") : `<li data-testid="exclusion-rules-empty">Nenhuma regra de exclusão configurada.</li>`}</ul>`,
    `<label for="settings-exclusion-pattern">Novo padrão de exclusão</label><input id="settings-exclusion-pattern" data-testid="settings-exclusion-pattern" placeholder="ex.: secrets/**" />`,
    `<button type="button" data-testid="add-exclusion">Adicionar exclusão</button>`,
    `</section>`,
  ].join("");
  const size = input.indexSizeSnapshot;
  const clearHtml = [
    `<section data-testid="settings-index-cleanup" aria-label="Limpeza do índice">`,
    `<h2>Limpar índice do workspace</h2>`,
    `<p>Escopo: workspace atual. Os dados locais indexados serão apagados.</p>`,
    size
      ? `<div data-testid="index-size-preview"><p>Arquivos: ${size.indexedFileCount}</p><p>Trechos: ${size.chunkCount}</p><p>Tamanho textual: ${size.lexicalBytes} bytes</p></div>`
      : `<p data-testid="index-size-unavailable">Consulte o tamanho antes de limpar.</p>`,
    `<button type="button" data-testid="describe-index-size">Consultar escopo e tamanho</button>`,
    `<button type="button" data-testid="clear-index"${size ? "" : " disabled"}>Limpar índice do workspace</button>`,
    `<label><input type="checkbox" data-testid="confirm-clear-index" /> Confirmo apagar os dados locais do índice deste workspace</label>`,
    `<p data-testid="index-clear-result" role="status">${input.isClearingIndex ? "Limpando índice…" : size && size.indexedFileCount === 0 && size.chunkCount === 0 ? "Índice do workspace vazio." : "A limpeza exige confirmação explícita."}</p>`,
    `</section>`,
  ].join("");
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
    exclusionHtml,
    clearHtml,
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
      exclusionRules: rules,
      indexSizeSnapshot: size,
      isClearingIndex: input.isClearingIndex ?? false,
    },
  };
}
