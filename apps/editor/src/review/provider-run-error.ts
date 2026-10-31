import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  isProviderErrorCode,
  type ProtocolErrorCode,
} from "@openagent/protocol";

import {
  buildProviderRunErrorView,
  type ProviderRunErrorPhase,
  type ProviderRunErrorViewSnapshot,
} from "./provider-run-error-view.js";

export type {
  ProviderRunErrorPhase,
  ProviderRunErrorViewSnapshot,
  ProviderRunResponseStatus,
} from "./provider-run-error-view.js";
export { buildProviderRunErrorView } from "./provider-run-error-view.js";

export const PROVIDER_RUN_ERROR_IDLE_MESSAGE =
  "Aguardando execução. Falhas do provedor preservam o texto digitado e o diff já produzido." as const;

export const PROVIDER_RUN_ERROR_FAILURE_MESSAGE =
  "Falha do provedor: a causa retornada é exibida; o texto digitado e o diff já produzido foram conservados." as const;

export const PROVIDER_RUN_ERROR_INCOMPLETE_MESSAGE =
  "Resposta Incompleta: a conexão caiu durante o streaming. Tente de novo sem repetir alteração já gravada." as const;

export interface ProviderRunRetryRequest {
  idempotentRetry: true;
  skipRepeatedMutations: true;
  promptText: string;
  preservedDiff: string | null;
  skipMutationIds: readonly string[];
  errorCode: ProtocolErrorCode;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Campo '${field}' inválido para erro de provedor/resposta incompleta.`,
      [field],
    );
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (text.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Campo '${field}' inválido para erro de provedor/resposta incompleta.`,
      [field],
    );
  }
  return text;
}

/**
 * API-02 / ERR-03: UI conserva prompt e diff em falha PROVIDER_*;
 * marca resposta Incompleta e oferece retry idempotente sem repetir mutações gravadas.
 */
export class ProviderRunErrorController {
  private view: ProviderRunErrorViewSnapshot;
  private promptText = "";
  private preservedDiff: string | null = null;
  private persistedMutationIds: string[] = [];
  private activeErrorCode: ProtocolErrorCode | null = null;

  constructor() {
    this.view = this.buildIdleView();
  }

  get snapshot(): ProviderRunErrorViewSnapshot {
    return this.view;
  }

  get phase(): ProviderRunErrorPhase {
    return this.view.accessible.phase;
  }

  /** Texto digitado no composer (API-02: conservar após falha). */
  setDraftPrompt(promptRaw: unknown): ProviderRunErrorViewSnapshot {
    this.promptText = requireString(promptRaw, "promptText");
    if (this.phase === "idle") {
      this.view = this.buildIdleView();
    } else {
      this.view = this.rebuildCurrentView();
    }
    return this.view;
  }

  /** Diff já produzido no run (API-02: não apagar). */
  setPreservedDiff(diffRaw: unknown): ProviderRunErrorViewSnapshot {
    this.preservedDiff = requireString(diffRaw, "preservedDiff");
    if (this.phase === "idle") {
      this.view = this.buildIdleView();
    } else {
      this.view = this.rebuildCurrentView();
    }
    return this.view;
  }

  /** Mutação já persistida — retry idempotente deve pular (ERR-03). */
  recordPersistedMutation(mutationIdRaw: unknown): void {
    const mutationId = requireNonEmptyString(mutationIdRaw, "mutationId");
    if (!this.persistedMutationIds.includes(mutationId)) {
      this.persistedMutationIds.push(mutationId);
    }
  }

  /**
   * API-02: falha PROVIDER_* exibe causa, conserva prompt e diff.
   */
  acceptProviderFailure(error: ProtocolError): ProviderRunErrorViewSnapshot {
    if (!(error instanceof ProtocolError) || !isProviderErrorCode(error.code)) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Esperado código PROVIDER_* para falha de provedor na UI.",
        [String((error as { code?: unknown })?.code ?? typeof error)],
      );
    }
    if (error.hints?.preservePrompt !== true || error.hints?.preserveDiff !== true) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Falha de provedor sem hints de preservação de prompt/diff.",
        [error.code],
      );
    }
    const providerCause = requireNonEmptyString(
      error.hints.providerCause ?? error.message,
      "providerCause",
    );
    const promptBefore = this.promptText;
    const diffBefore = this.preservedDiff;
    this.activeErrorCode = error.code;
    this.view = buildProviderRunErrorView({
      phase: "provider_failure",
      message: PROVIDER_RUN_ERROR_FAILURE_MESSAGE,
      promptText: this.promptText,
      providerCause,
      errorCode: error.code,
      responseStatus: "failed",
      preservedDiff: this.preservedDiff,
      canRetry: false,
      skipMutationIds: [...this.persistedMutationIds],
    });
    if (this.view.accessible.promptText !== promptBefore) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Falha de provedor apagou o texto digitado.",
        [],
      );
    }
    if (this.view.accessible.preservedDiff !== diffBefore) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Falha de provedor apagou o diff já produzido.",
        [],
      );
    }
    return this.view;
  }

  /**
   * ERR-03: marca resposta Incompleta e habilita retry sem repetir mutações gravadas.
   */
  acceptIncompleteStream(
    error: ProtocolError,
    partialAssistantTextRaw?: unknown,
  ): ProviderRunErrorViewSnapshot {
    if (!(error instanceof ProtocolError) || error.code !== PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Esperado código INCOMPLETE_STREAM para resposta incompleta na UI.",
        [String((error as { code?: unknown })?.code ?? typeof error)],
      );
    }
    if (error.hints?.idempotentRetry !== true || error.hints?.skipRepeatedMutations !== true) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Stream incompleto sem hints de retry idempotente.",
        [error.code],
      );
    }
    if (partialAssistantTextRaw !== undefined) {
      requireString(partialAssistantTextRaw, "partialAssistantText");
    }
    const promptBefore = this.promptText;
    const diffBefore = this.preservedDiff;
    const mutationsBefore = [...this.persistedMutationIds];
    this.activeErrorCode = PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM;
    this.view = buildProviderRunErrorView({
      phase: "incomplete",
      message: PROVIDER_RUN_ERROR_INCOMPLETE_MESSAGE,
      promptText: this.promptText,
      providerCause: error.message,
      errorCode: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
      responseStatus: "incomplete",
      preservedDiff: this.preservedDiff,
      canRetry: true,
      skipMutationIds: [...this.persistedMutationIds],
    });
    if (this.view.accessible.promptText !== promptBefore) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Resposta incompleta apagou o texto digitado.",
        [],
      );
    }
    if (this.view.accessible.preservedDiff !== diffBefore) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Resposta incompleta apagou o diff já produzido.",
        [],
      );
    }
    if (
      mutationsBefore.length !== this.persistedMutationIds.length ||
      mutationsBefore.some((id, index) => id !== this.persistedMutationIds[index])
    ) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Resposta incompleta alterou mutações já gravadas.",
        [],
      );
    }
    return this.view;
  }

  /**
   * ERR-03: solicita retry idempotente; não limpa prompt, diff nem mutações gravadas.
   */
  requestRetry(): ProviderRunRetryRequest {
    if (this.phase !== "incomplete" || this.activeErrorCode !== PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Retry só é permitido com resposta Incompleta.",
        [this.phase],
      );
    }
    if (!this.view.accessible.canRetry) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Retry indisponível no estado atual.",
        [],
      );
    }
    return {
      idempotentRetry: true,
      skipRepeatedMutations: true,
      promptText: this.promptText,
      preservedDiff: this.preservedDiff,
      skipMutationIds: [...this.persistedMutationIds],
      errorCode: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
    };
  }

  dismiss(): void {
    this.activeErrorCode = null;
    this.view = this.buildIdleView();
  }

  private buildIdleView(): ProviderRunErrorViewSnapshot {
    return buildProviderRunErrorView({
      phase: "idle",
      message: PROVIDER_RUN_ERROR_IDLE_MESSAGE,
      promptText: this.promptText,
      providerCause: null,
      errorCode: null,
      responseStatus: "idle",
      preservedDiff: this.preservedDiff,
      canRetry: false,
      skipMutationIds: [...this.persistedMutationIds],
    });
  }

  private rebuildCurrentView(): ProviderRunErrorViewSnapshot {
    const accessible = this.view.accessible;
    return buildProviderRunErrorView({
      phase: accessible.phase,
      message: accessible.message,
      promptText: this.promptText,
      providerCause: accessible.providerCause,
      errorCode: accessible.errorCode,
      responseStatus: accessible.responseStatus,
      preservedDiff: this.preservedDiff,
      canRetry: accessible.canRetry,
      skipMutationIds: [...this.persistedMutationIds],
    });
  }
}
