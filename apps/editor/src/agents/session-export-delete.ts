import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
} from "@openagent/protocol";

import type { AgentHistoryMessage } from "../agent/agent-history.js";
import {
  buildSessionDeleteView,
  buildSessionExportDeleteView,
  buildSessionExportView,
  type SessionDeleteUiPhase,
  type SessionDeleteViewSnapshot,
  type SessionExportDeleteViewSnapshot,
  type SessionExportUiPhase,
  type SessionExportViewSnapshot,
} from "./session-export-delete-view.js";

export type {
  SessionDeleteUiPhase,
  SessionDeleteViewSnapshot,
  SessionExportDeleteViewSnapshot,
  SessionExportUiPhase,
  SessionExportViewSnapshot,
} from "./session-export-delete-view.js";
export {
  buildSessionDeleteView,
  buildSessionExportDeleteView,
  buildSessionExportView,
} from "./session-export-delete-view.js";

export interface SessionExportPort {
  exportSession(input: {
    method: typeof RPC_METHOD.SESSION_EXPORT;
    sessionId: string;
    payload?: { format?: "text" };
  }): Promise<{ exportRef: string }>;
}

export interface SessionDeletePort {
  deleteSession(input: {
    method: typeof RPC_METHOD.SESSION_DELETE;
    sessionId: string;
    payload?: Record<string, never>;
  }): Promise<{ deleted: true }>;
}

export interface SessionExportRequestResult {
  rpc: {
    method: typeof RPC_METHOD.SESSION_EXPORT;
    sessionId: string;
    payload: { format: "text" };
  };
  view: SessionExportViewSnapshot;
}

export interface SessionDeleteRequestResult {
  rpc: {
    method: typeof RPC_METHOD.SESSION_DELETE;
    sessionId: string;
    payload: Record<string, never>;
  };
  view: SessionDeleteViewSnapshot;
}

export interface SessionExportOptions {
  format?: "text" | "json";
  outputPath?: string;
  allowedRoot?: string;
}

export interface SessionDeleteOptions {
  targetWorkspaceId?: string;
  allowedWorkspaceId?: string;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function outOfScope(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.OUT_OF_SCOPE, message, [...details]);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidState(`Campo '${field}' inválido para gerenciamento de sessão.`, [field]);
  }
  return value.trim();
}

function validateExportPath(outputPath: string | undefined, allowedRoot?: string): void {
  if (outputPath === undefined) {
    return;
  }
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    throw invalidState("outputPath inválido para exportação de sessão.", ["outputPath"]);
  }
  const normalized = outputPath.replaceAll("\\", "/");
  if (normalized.includes("../") || normalized.endsWith("/..") || normalized === "..") {
    throw outOfScope("Caminho de exportação fora do escopo permitido (path traversal detectado).", [
      outputPath,
    ]);
  }
  if (allowedRoot !== undefined) {
    const rootNorm = allowedRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!normalized.startsWith(rootNorm + "/") && normalized !== rootNorm) {
      throw outOfScope("Caminho de exportação fora do escopo do workspace.", [outputPath, allowedRoot]);
    }
  }
}

/**
 * Controller observável para exportação de sessão (SES-02).
 */
export class SessionExportController {
  private readonly sessionIdValue: string;
  private phase: SessionExportUiPhase = "idle";
  private exportRef: string | null = null;
  private readonly messages: AgentHistoryMessage[];

  constructor(sessionId: string, initialMessages: readonly AgentHistoryMessage[] = []) {
    this.sessionIdValue = requireNonEmptyString(sessionId, "sessionId");
    this.messages = [...initialMessages];
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get messageCount(): number {
    return this.messages.length;
  }

  get snapshot(): SessionExportViewSnapshot {
    return buildSessionExportView({
      sessionId: this.sessionIdValue,
      phase: this.phase,
      exportRef: this.exportRef,
      messageCount: this.messages.length,
    });
  }

  requestExport(options: SessionExportOptions = {}): SessionExportRequestResult {
    if (this.phase === "pending") {
      throw invalidState("Exportação já está em andamento para esta sessão.", [this.phase]);
    }

    if (options.format !== undefined && options.format !== "text") {
      throw invalidState("Apenas exportação em formato 'text' é suportada nesta versão.", [
        String(options.format),
      ]);
    }

    validateExportPath(options.outputPath, options.allowedRoot);

    this.phase = "pending";
    return {
      rpc: {
        method: RPC_METHOD.SESSION_EXPORT,
        sessionId: this.sessionIdValue,
        payload: { format: "text" },
      },
      view: this.snapshot,
    };
  }

  acceptExport(raw: unknown): SessionExportViewSnapshot {
    if (this.phase !== "pending") {
      throw invalidState("Resultado de exportação só é aceito após requestExport pendente.", [
        this.phase,
      ]);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw invalidState("Resultado de exportação inválido retornado pelo RPC.", ["result"]);
    }
    const record = raw as Record<string, unknown>;
    const exportRef = record.exportRef;
    if (typeof exportRef !== "string" || exportRef.trim().length === 0) {
      throw invalidState("exportRef inválido no resultado de exportação.", ["exportRef"]);
    }

    this.exportRef = exportRef.trim();
    this.phase = "exported";
    return this.snapshot;
  }

  async exportViaPort(
    port: SessionExportPort,
    options: SessionExportOptions = {},
  ): Promise<{ rpc: SessionExportRequestResult["rpc"]; exportRef: string; view: SessionExportViewSnapshot }> {
    const pending = this.requestExport(options);
    try {
      const result = await port.exportSession(pending.rpc);
      const view = this.acceptExport(result);
      return { rpc: pending.rpc, exportRef: this.exportRef as string, view };
    } catch (error) {
      if (this.phase === "pending") {
        this.phase = "idle";
      }
      throw error;
    }
  }
}

/**
 * Controller observável para exclusão de sessão (SES-07).
 */
export class SessionDeleteController {
  private readonly sessionIdValue: string;
  private phase: SessionDeleteUiPhase = "idle";
  private messages: AgentHistoryMessage[];

  constructor(sessionId: string, initialMessages: readonly AgentHistoryMessage[] = []) {
    this.sessionIdValue = requireNonEmptyString(sessionId, "sessionId");
    this.messages = [...initialMessages];
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get currentMessages(): readonly AgentHistoryMessage[] {
    return this.messages;
  }

  get snapshot(): SessionDeleteViewSnapshot {
    return buildSessionDeleteView({
      sessionId: this.sessionIdValue,
      phase: this.phase,
      messageCount: this.messages.length,
    });
  }

  requestDeleteConfirm(): SessionDeleteViewSnapshot {
    if (this.phase === "deleted") {
      throw invalidState("Sessão já foi apagada e não pode ser apagada novamente.", [this.phase]);
    }
    if (this.phase === "pending") {
      throw invalidState("Exclusão de sessão já está em andamento.", [this.phase]);
    }
    this.phase = "confirming";
    return this.snapshot;
  }

  cancelDeleteConfirm(): SessionDeleteViewSnapshot {
    if (this.phase === "confirming") {
      this.phase = "idle";
    }
    return this.snapshot;
  }

  requestDelete(options: SessionDeleteOptions = {}): SessionDeleteRequestResult {
    if (this.phase !== "confirming") {
      throw invalidState(
        "Exclusão de sessão exige confirmação explícita prévia (chame requestDeleteConfirm).",
        [this.phase],
      );
    }

    if (
      options.targetWorkspaceId !== undefined &&
      options.allowedWorkspaceId !== undefined &&
      options.targetWorkspaceId !== options.allowedWorkspaceId
    ) {
      throw outOfScope("Sessão fora do escopo do workspace autorizado.", [
        options.targetWorkspaceId,
        options.allowedWorkspaceId,
      ]);
    }

    this.phase = "pending";
    return {
      rpc: {
        method: RPC_METHOD.SESSION_DELETE,
        sessionId: this.sessionIdValue,
        payload: {},
      },
      view: this.snapshot,
    };
  }

  acceptDelete(raw: unknown): SessionDeleteViewSnapshot {
    if (this.phase !== "pending") {
      throw invalidState("Resultado de exclusão só é aceito após requestDelete pendente.", [
        this.phase,
      ]);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw invalidState("Resultado de exclusão inválido retornado pelo RPC.", ["result"]);
    }
    const record = raw as Record<string, unknown>;
    if (record.deleted !== true) {
      throw invalidState("Exclusão não confirmada pelo RPC (esperado deleted: true).", [
        String(record.deleted),
      ]);
    }

    this.messages = [];
    this.phase = "deleted";
    return this.snapshot;
  }

  async deleteViaPort(
    port: SessionDeletePort,
    options: SessionDeleteOptions = {},
  ): Promise<{ rpc: SessionDeleteRequestResult["rpc"]; view: SessionDeleteViewSnapshot }> {
    if (this.phase === "idle") {
      this.requestDeleteConfirm();
    }
    const pending = this.requestDelete(options);
    try {
      const result = await port.deleteSession(pending.rpc);
      const view = this.acceptDelete(result);
      return { rpc: pending.rpc, view };
    } catch (error) {
      if (this.phase === "pending") {
        this.phase = "idle";
      }
      throw error;
    }
  }
}

/**
 * Controller unificado de exportação e exclusão de sessão (SES-02, SES-07).
 */
export class SessionExportDeleteController {
  private readonly sessionIdValue: string;
  private readonly exportController: SessionExportController;
  private readonly deleteController: SessionDeleteController;

  constructor(sessionId: string, initialMessages: readonly AgentHistoryMessage[] = []) {
    this.sessionIdValue = requireNonEmptyString(sessionId, "sessionId");
    this.exportController = new SessionExportController(this.sessionIdValue, initialMessages);
    this.deleteController = new SessionDeleteController(this.sessionIdValue, initialMessages);
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get messages(): readonly AgentHistoryMessage[] {
    return this.deleteController.currentMessages;
  }

  get snapshot(): SessionExportDeleteViewSnapshot {
    const exportSnap = this.exportController.snapshot;
    const deleteSnap = this.deleteController.snapshot;
    return buildSessionExportDeleteView({
      sessionId: this.sessionIdValue,
      exportPhase: exportSnap.accessible.phase,
      deletePhase: deleteSnap.accessible.phase,
      exportRef: exportSnap.accessible.exportRef,
      messageCount: this.deleteController.currentMessages.length,
      messages: this.deleteController.currentMessages,
    });
  }

  requestExport(options: SessionExportOptions = {}): SessionExportRequestResult {
    return this.exportController.requestExport(options);
  }

  acceptExport(raw: unknown): SessionExportDeleteViewSnapshot {
    this.exportController.acceptExport(raw);
    return this.snapshot;
  }

  async exportViaPort(
    port: SessionExportPort,
    options: SessionExportOptions = {},
  ): Promise<{ rpc: SessionExportRequestResult["rpc"]; exportRef: string; view: SessionExportDeleteViewSnapshot }> {
    const res = await this.exportController.exportViaPort(port, options);
    return { rpc: res.rpc, exportRef: res.exportRef, view: this.snapshot };
  }

  requestDeleteConfirm(): SessionExportDeleteViewSnapshot {
    this.deleteController.requestDeleteConfirm();
    return this.snapshot;
  }

  cancelDeleteConfirm(): SessionExportDeleteViewSnapshot {
    this.deleteController.cancelDeleteConfirm();
    return this.snapshot;
  }

  requestDelete(options: SessionDeleteOptions = {}): SessionDeleteRequestResult {
    return this.deleteController.requestDelete(options);
  }

  acceptDelete(raw: unknown): SessionExportDeleteViewSnapshot {
    this.deleteController.acceptDelete(raw);
    return this.snapshot;
  }

  async deleteViaPort(
    port: SessionDeletePort,
    options: SessionDeleteOptions = {},
  ): Promise<{ rpc: SessionDeleteRequestResult["rpc"]; view: SessionExportDeleteViewSnapshot }> {
    const res = await this.deleteController.deleteViaPort(port, options);
    return { rpc: res.rpc, view: this.snapshot };
  }
}
