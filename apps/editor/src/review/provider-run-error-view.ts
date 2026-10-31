/** API-02 / ERR-03: UI de falha de provedor e resposta incompleta com retry. */

export type ProviderRunErrorPhase = "idle" | "provider_failure" | "incomplete";

export type ProviderRunResponseStatus = "idle" | "failed" | "incomplete";

export interface ProviderRunErrorViewInput {
  phase: ProviderRunErrorPhase;
  message: string;
  promptText: string;
  providerCause: string | null;
  errorCode: string | null;
  responseStatus: ProviderRunResponseStatus;
  preservedDiff: string | null;
  canRetry: boolean;
  skipMutationIds: readonly string[];
}

export interface ProviderRunErrorViewSnapshot {
  html: string;
  accessible: {
    phase: ProviderRunErrorPhase;
    message: string;
    promptText: string;
    providerCause: string | null;
    errorCode: string | null;
    responseStatus: ProviderRunResponseStatus;
    preservedDiff: string | null;
    canRetry: boolean;
    skipMutationIds: readonly string[];
    promptCleared: false;
    diffCleared: false;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildProviderRunErrorView(
  input: ProviderRunErrorViewInput,
): ProviderRunErrorViewSnapshot {
  const causeBlock =
    input.providerCause !== null
      ? `<p data-testid="provider-run-error-cause">${escapeHtml(input.providerCause)}</p>`
      : "";
  const codeBlock =
    input.errorCode !== null
      ? `<span data-testid="provider-run-error-code">${escapeHtml(input.errorCode)}</span>`
      : "";
  const statusLabel =
    input.responseStatus === "incomplete"
      ? "Incompleta"
      : input.responseStatus === "failed"
        ? "Falha do provedor"
        : "Pronto";
  const retryControl = input.canRetry
    ? `<button type="button" data-testid="provider-run-error-retry">Tentar de novo</button>`
    : "";
  const diffBlock =
    input.preservedDiff !== null
      ? `<pre data-testid="provider-run-error-diff">${escapeHtml(input.preservedDiff)}</pre>`
      : `<pre data-testid="provider-run-error-diff" data-empty="true"></pre>`;
  const skipIds =
    input.skipMutationIds.length > 0
      ? `<ul data-testid="provider-run-error-skip-mutations">${input.skipMutationIds
          .map(
            (id) =>
              `<li data-testid="provider-run-error-skip-id" data-mutation-id="${escapeHtml(id)}">${escapeHtml(id)}</li>`,
          )
          .join("")}</ul>`
      : "";

  const html = [
    `<section role="region" data-testid="provider-run-error" data-phase="${escapeHtml(input.phase)}" aria-label="Erro de execução do provedor">`,
    `<p data-testid="provider-run-error-message">${escapeHtml(input.message)}</p>`,
    codeBlock,
    causeBlock,
    `<span data-testid="provider-run-error-status" data-status="${escapeHtml(input.responseStatus)}">${escapeHtml(statusLabel)}</span>`,
    `<textarea data-testid="provider-run-error-prompt" readonly aria-label="Texto digitado preservado">${escapeHtml(input.promptText)}</textarea>`,
    diffBlock,
    skipIds,
    retryControl,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      phase: input.phase,
      message: input.message,
      promptText: input.promptText,
      providerCause: input.providerCause,
      errorCode: input.errorCode,
      responseStatus: input.responseStatus,
      preservedDiff: input.preservedDiff,
      canRetry: input.canRetry,
      skipMutationIds: [...input.skipMutationIds],
      promptCleared: false,
      diffCleared: false,
    },
  };
}
