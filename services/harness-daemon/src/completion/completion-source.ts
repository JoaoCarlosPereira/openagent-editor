import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  type CompletionKind,
} from "@openagent/protocol";
import {
  getStoredProviderProfile,
  openWorkspaceDatabase,
  readProviderCredentialFromVault,
  resolveSystemSecretVault,
  type SystemSecretVault,
} from "@openagent/storage";
import { streamCliProxyChatText } from "@openagent/model-gateway";
import { DatabaseSync } from "node:sqlite";

export type CompletionSourceInput = {
  workspaceId: string;
  providerProfileId: string;
  sessionId: string;
  runId: string;
  completionId: string;
  prefix: string;
  suffix: string;
  language?: string;
  kind: CompletionKind;
  /** Texto já gerado em tentativa anterior; a fonte deve continuar a partir dele (retry). */
  resumeText: string;
  /** Abortado no cancelamento ou ao encerrar o pedido; a fonte deve liberar a conexão. */
  signal: AbortSignal;
};

/** Fonte de texto do completion: produz deltas de texto para um pedido. */
export type CompletionTextSource = (
  input: CompletionSourceInput,
) => AsyncIterable<string> | Promise<AsyncIterable<string>>;

function buildMessages(input: CompletionSourceInput) {
  const shape = input.kind === "line" ? "a single line" : "a short code block";
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system" as const,
      content: `You are a code completion engine. Return only ${shape} that continues the code. Do not repeat the prefix and do not add commentary.`,
    },
    {
      role: "user" as const,
      content: [
        `Language: ${input.language ?? "unspecified"}`,
        "<prefix>",
        input.prefix,
        "</prefix>",
        "<suffix>",
        input.suffix,
        "</suffix>",
      ].join("\n"),
    },
  ];
  if (input.resumeText.length > 0) {
    messages.push(
      { role: "assistant", content: input.resumeText },
      {
        role: "user",
        content: "Continue exactly where the previous answer stopped. Return only the remaining text.",
      },
    );
  }
  return messages;
}

/**
 * Fonte padrão (ADR-005): usa o perfil de provedor do workspace e o CLIProxyAPI via
 * model-gateway. A credencial vem do cofre do SO e nunca é registrada em evento/log.
 */
export function createCliProxyCompletionSource(options: {
  dataRoot: string;
  vault?: SystemSecretVault;
}): CompletionTextSource {
  return async (input) => {
    const db = openWorkspaceDatabase({ dataRoot: options.dataRoot, workspaceId: input.workspaceId });
    let profile: ReturnType<typeof getStoredProviderProfile>;
    try {
      const sqlite = new DatabaseSync(db.databasePath);
      try {
        profile = getStoredProviderProfile(sqlite, input.providerProfileId);
      } finally {
        sqlite.close();
      }
    } finally {
      db.close();
    }
    if (!profile) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Perfil de provedor não está registrado para completion.",
        [input.providerProfileId],
      );
    }
    const credential = await readProviderCredentialFromVault(
      profile.secretRef,
      options.vault ?? resolveSystemSecretVault(),
    );
    if (!credential) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Credencial do provedor indisponível no cofre do sistema.",
        [input.providerProfileId],
      );
    }
    return streamCliProxyChatText({
      endpoint: credential.endpoint,
      model: credential.model,
      credential: credential.credential,
      messages: buildMessages(input),
      signal: input.signal,
      runId: input.runId,
      sessionId: input.sessionId,
      messageId: `completion-${input.completionId}`,
    });
  };
}
