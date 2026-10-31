export type SessionExportUiPhase = "idle" | "pending" | "exported";
export type SessionDeleteUiPhase = "idle" | "confirming" | "pending" | "deleted";

export interface SessionExportViewInput {
  sessionId: string;
  phase: SessionExportUiPhase;
  exportRef: string | null;
  messageCount: number;
}

export interface SessionExportViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    phase: SessionExportUiPhase;
    exportRef: string | null;
    messageCount: number;
    exported: boolean;
  };
}

export interface SessionDeleteViewInput {
  sessionId: string;
  phase: SessionDeleteUiPhase;
  messageCount: number;
}

export interface SessionDeleteViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    phase: SessionDeleteUiPhase;
    messageCount: number;
    deleted: boolean;
    localMessagesRemoved: boolean;
  };
}

export interface SessionExportDeleteViewInput {
  sessionId: string;
  exportPhase: SessionExportUiPhase;
  deletePhase: SessionDeleteUiPhase;
  exportRef: string | null;
  messageCount: number;
  messages: readonly { id: string; role: string; content: string }[];
}

export interface SessionExportDeleteViewSnapshot {
  html: string;
  accessible: {
    sessionId: string;
    exportPhase: SessionExportUiPhase;
    deletePhase: SessionDeleteUiPhase;
    exportRef: string | null;
    deleted: boolean;
    localMessagesRemoved: boolean;
    messageCount: number;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildSessionExportView(input: SessionExportViewInput): SessionExportViewSnapshot {
  const status =
    input.phase === "pending"
      ? "Exportando mensagens da sessão em arquivo de texto…"
      : input.phase === "exported"
        ? `Sessão exportada com sucesso: ${input.exportRef ?? "arquivo gravado"}`
        : "Exporte as mensagens desta sessão para um arquivo de texto.";

  const refAttr = input.exportRef ? ` data-export-ref="${escapeHtml(input.exportRef)}"` : "";

  return {
    html: [
      `<section data-testid="session-export-panel"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-phase="${input.phase}"${refAttr}>`,
      `<h3>Exportar sessão</h3>`,
      `<button type="button" data-testid="session-export-button"`,
      input.phase === "pending" ? ` disabled` : ``,
      ` aria-label="Exportar sessão">Exportar sessão</button>`,
      `<p data-testid="session-export-status" role="status">${escapeHtml(status)}</p>`,
      input.exportRef
        ? `<span data-testid="session-export-ref">${escapeHtml(input.exportRef)}</span>`
        : ``,
      `</section>`,
    ].join(""),
    accessible: {
      sessionId: input.sessionId,
      phase: input.phase,
      exportRef: input.exportRef,
      messageCount: input.messageCount,
      exported: input.phase === "exported",
    },
  };
}

export function buildSessionDeleteView(input: SessionDeleteViewInput): SessionDeleteViewSnapshot {
  const isDeleted = input.phase === "deleted";
  const status =
    input.phase === "confirming"
      ? "Confirmação necessária para apagar a sessão e suas mensagens locais."
      : input.phase === "pending"
        ? "Apagando sessão e mensagens locais…"
        : isDeleted
          ? "Sessão e mensagens locais removidas com sucesso."
          : "Apague a sessão e remova todas as mensagens locais.";

  const confirmDialog =
    input.phase === "confirming"
      ? [
          `<dialog data-testid="session-delete-dialog" open>`,
          `<p>Tem certeza de que deseja apagar a sessão e remover todas as mensagens locais?</p>`,
          `<button type="button" data-testid="session-delete-confirm-button">Confirmar exclusão</button>`,
          `<button type="button" data-testid="session-delete-cancel-button">Cancelar</button>`,
          `</dialog>`,
        ].join("")
      : ``;

  return {
    html: [
      `<section data-testid="session-delete-panel"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-phase="${input.phase}"`,
      ` data-session-deleted="${isDeleted ? "true" : "false"}">`,
      `<h3>Apagar sessão</h3>`,
      `<button type="button" data-testid="session-delete-button"`,
      input.phase === "pending" || isDeleted ? ` disabled` : ``,
      ` aria-label="Apagar sessão">Apagar sessão</button>`,
      confirmDialog,
      `<p data-testid="session-delete-status" role="status">${escapeHtml(status)}</p>`,
      `</section>`,
    ].join(""),
    accessible: {
      sessionId: input.sessionId,
      phase: input.phase,
      messageCount: input.messageCount,
      deleted: isDeleted,
      localMessagesRemoved: isDeleted,
    },
  };
}

export function buildSessionExportDeleteView(
  input: SessionExportDeleteViewInput,
): SessionExportDeleteViewSnapshot {
  const isDeleted = input.deletePhase === "deleted";
  const exportView = buildSessionExportView({
    sessionId: input.sessionId,
    phase: input.exportPhase,
    exportRef: input.exportRef,
    messageCount: input.messageCount,
  });
  const deleteView = buildSessionDeleteView({
    sessionId: input.sessionId,
    phase: input.deletePhase,
    messageCount: isDeleted ? 0 : input.messageCount,
  });

  const messagesHtml = isDeleted
    ? `<ul data-testid="session-messages-list" data-empty="true"></ul>`
    : [
        `<ul data-testid="session-messages-list">`,
        ...input.messages.map(
          (m) =>
            `<li data-message-id="${escapeHtml(m.id)}" data-role="${escapeHtml(m.role)}">${escapeHtml(m.content)}</li>`,
        ),
        `</ul>`,
      ].join("");

  return {
    html: [
      `<section data-testid="session-export-delete-panel"`,
      ` data-session-id="${escapeHtml(input.sessionId)}"`,
      ` data-export-phase="${input.exportPhase}"`,
      ` data-delete-phase="${input.deletePhase}"`,
      ` data-session-deleted="${isDeleted ? "true" : "false"}">`,
      `<h2>Gerenciamento de sessão</h2>`,
      exportView.html,
      deleteView.html,
      messagesHtml,
      `</section>`,
    ].join(""),
    accessible: {
      sessionId: input.sessionId,
      exportPhase: input.exportPhase,
      deletePhase: input.deletePhase,
      exportRef: input.exportRef,
      deleted: isDeleted,
      localMessagesRemoved: isDeleted,
      messageCount: isDeleted ? 0 : input.messageCount,
    },
  };
}
