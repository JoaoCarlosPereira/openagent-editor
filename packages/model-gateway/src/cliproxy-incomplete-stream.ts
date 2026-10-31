import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type ProtocolErrorCode,
} from "@openagent/protocol";

import {
  CLI_PROXY_STREAM_HARNESS_EVENT_TYPES,
  type CliProxyStreamHarnessNormalization,
} from "./cliproxy-stream-harness-normalizer.js";

export type IncompleteStreamRunState = {
  partialAssistantText: string;
  persistedMutationIds: readonly string[];
};

export type IncompleteStreamRetryOutcome = {
  code: ProtocolErrorCode;
  partialAssistantText: string;
  skipMutationIds: readonly string[];
  idempotentRetry: true;
  skipRepeatedMutations: true;
};

function assertIncompleteStreamHints(error: ProtocolError): void {
  if (error.hints?.idempotentRetry !== true) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Stream incompleto sem instrução de retry idempotente.",
    );
  }
  if (error.hints?.skipRepeatedMutations !== true) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Stream incompleto sem instrução de pular mutações repetidas.",
    );
  }
}

function assertMessageIncompleteEvent(
  event: CliProxyStreamHarnessNormalization,
): void {
  if (event.type !== CLI_PROXY_STREAM_HARNESS_EVENT_TYPES.MESSAGE_INCOMPLETE) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Evento de stream incompleto esperado message.incomplete.",
    );
  }
  if (event.payload.status !== "incomplete") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Payload de stream incompleto deve marcar status incomplete.",
    );
  }
}

/**
 * ERR-03: aplica INCOMPLETE_STREAM preservando texto parcial e evitando repetir mutações já gravadas no retry.
 */
export function resolveCliProxyIncompleteStreamRetry(
  error: ProtocolError,
  incompleteEvent: CliProxyStreamHarnessNormalization,
  state: IncompleteStreamRunState,
  pendingMutationIds: readonly string[],
): IncompleteStreamRetryOutcome {
  if (!(error instanceof ProtocolError)) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Entrada inválida para retry de stream incompleto.",
    );
  }
  if (error.code !== PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM) {
    throw error;
  }
  assertIncompleteStreamHints(error);
  assertMessageIncompleteEvent(incompleteEvent);

  const eventText =
    typeof incompleteEvent.payload.text === "string" ? incompleteEvent.payload.text : "";
  const partialAssistantText = eventText.length > 0 ? eventText : state.partialAssistantText;

  const persisted = new Set(state.persistedMutationIds);
  const skipMutationIds = pendingMutationIds.filter((id) => persisted.has(id));

  return {
    code: PROTOCOL_ERROR_CODES.INCOMPLETE_STREAM,
    partialAssistantText,
    skipMutationIds,
    idempotentRetry: true,
    skipRepeatedMutations: true,
  };
}

/** Garante que estado de run não foi mutado indevidamente (caminhos de erro). */
export function assertIncompleteStreamRunStateUnchanged(
  before: IncompleteStreamRunState,
  after: IncompleteStreamRunState,
): void {
  if (
    before.partialAssistantText !== after.partialAssistantText ||
    before.persistedMutationIds.length !== after.persistedMutationIds.length ||
    before.persistedMutationIds.some((id, index) => id !== after.persistedMutationIds[index])
  ) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Stream incompleto alterou estado de run indevidamente.",
    );
  }
}
