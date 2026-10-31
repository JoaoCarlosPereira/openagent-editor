import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  isProviderErrorCode,
  type ProtocolErrorCode,
} from "@openagent/protocol";

import { providerFailurePreservationHints, redactProviderCredentials } from "./cliproxy-provider-errors.js";

export type ProviderFailureEditorState = {
  draftPrompt: string;
  producedDiff: string | null;
};

export type ProviderFailurePreservationOutcome = {
  code: ProtocolErrorCode;
  displayCause: string;
  draftPrompt: string;
  producedDiff: string | null;
  preservePrompt: true;
  preserveDiff: true;
};

function assertPreservationHints(error: ProtocolError): void {
  const hints = providerFailurePreservationHints();
  if (error.hints?.preservePrompt !== hints.preservePrompt) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Falha do provedor sem instrução de preservar o prompt.",
    );
  }
  if (error.hints?.preserveDiff !== hints.preserveDiff) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Falha do provedor sem instrução de preservar o diff.",
    );
  }
}

/**
 * API-02: aplica falha PROVIDER_* exibindo a causa retornada sem apagar prompt digitado nem diff já produzido.
 */
export function resolveCliProxyProviderFailurePreservation(
  error: ProtocolError,
  state: ProviderFailureEditorState,
): ProviderFailurePreservationOutcome {
  if (!(error instanceof ProtocolError)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Entrada inválida para preservação de falha do provedor.",
    );
  }
  if (!isProviderErrorCode(error.code)) {
    throw error;
  }
  assertPreservationHints(error);

  const displayCause = redactProviderCredentials(
    (typeof error.hints?.providerCause === "string" && error.hints.providerCause.trim()) || error.message,
  );

  return {
    code: error.code,
    displayCause,
    draftPrompt: state.draftPrompt,
    producedDiff: state.producedDiff,
    preservePrompt: true,
    preserveDiff: true,
  };
}

/** Garante que estado de editor não foi mutado (testes e caminhos de erro). */
export function assertProviderFailureEditorStateUnchanged(
  before: ProviderFailureEditorState,
  after: ProviderFailureEditorState,
): void {
  if (before.draftPrompt !== after.draftPrompt || before.producedDiff !== after.producedDiff) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Falha do provedor alterou prompt ou diff indevidamente.",
    );
  }
}
