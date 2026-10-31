import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  type CheckpointRestoreConflictEntry as ProtocolConflictEntry,
  type RestoreResult,
} from "@openagent/protocol";

import {
  buildCheckpointRestoreView,
  type CheckpointRestoreConflictEntry,
  type CheckpointRestorePhase,
  type CheckpointRestoreViewSnapshot,
} from "./checkpoint-restore-view.js";

export type {
  CheckpointRestoreConflictEntry,
  CheckpointRestorePhase,
  CheckpointRestoreViewSnapshot,
} from "./checkpoint-restore-view.js";
export { buildCheckpointRestoreView } from "./checkpoint-restore-view.js";

export const CHECKPOINT_RESTORE_IDLE_MESSAGE =
  "Selecione um checkpoint para restaurar apenas os arquivos daquela execução." as const;

export const CHECKPOINT_RESTORE_OK_MESSAGE =
  "Checkpoint restaurado: apenas arquivos marcados como alteração da execução foram revertidos." as const;

export const CHECKPOINT_RESTORE_CONFLICT_MESSAGE =
  "Conflito ao restaurar: o arquivo mudou desde o checkpoint; as duas versões são exibidas sem gravar por cima." as const;

export interface CheckpointRestoreRequest {
  rpc: {
    method: typeof RPC_METHOD.CHECKPOINT_RESTORE;
    params: { checkpointId: string };
  };
  view: CheckpointRestoreViewSnapshot;
}

export interface AcceptRestoreOutcomeInput {
  result: RestoreResult;
  /** Paths do run cobertos pelo checkpoint (SES-03: só estes entram no sucesso). */
  restoredPaths?: readonly string[];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Campo '${field}' inválido para restauração de checkpoint.`,
      [field],
    );
  }
  return value.trim();
}

/** Conteúdo de arquivo: string obrigatória, sem trim (preserva newlines SES-03/ERR-01). */
function requireContentString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      `Campo '${field}' inválido para restauração de checkpoint.`,
      [field],
    );
  }
  return value;
}

function normalizeConflictEntries(
  conflicts: readonly ProtocolConflictEntry[],
): CheckpointRestoreConflictEntry[] {
  if (conflicts.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Resultado de conflito de restore exige ao menos um arquivo.",
      ["conflicts"],
    );
  }
  return conflicts.map((entry) => ({
    relativePath: requireNonEmptyString(entry.relativePath, "relativePath"),
    currentContent: requireContentString(entry.currentContent, "currentContent"),
    proposedContent: requireContentString(entry.proposedContent, "proposedContent"),
  }));
}

function normalizeRestoredPaths(paths: readonly string[] | undefined): string[] {
  if (!paths || paths.length === 0) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Restauração bem-sucedida exige a lista de arquivos da execução.",
      ["restoredPaths"],
    );
  }
  return paths.map((path) => requireNonEmptyString(path, "restoredPaths[]"));
}

/**
 * SES-03: UI dispara checkpoint.restore e apresenta sucesso (só paths do run) ou conflito sem sobrescrita.
 */
export class CheckpointRestoreController {
  private view: CheckpointRestoreViewSnapshot;
  private pendingCheckpointId: string | null = null;

  constructor() {
    this.view = buildCheckpointRestoreView({
      phase: "idle",
      checkpointId: null,
      message: CHECKPOINT_RESTORE_IDLE_MESSAGE,
      restoredPaths: [],
      conflicts: [],
    });
  }

  get snapshot(): CheckpointRestoreViewSnapshot {
    return this.view;
  }

  get phase(): CheckpointRestorePhase {
    return this.view.accessible.phase;
  }

  /**
   * Ação de UI: valida o id e devolve o RPC checkpoint.restore (sem efeito colateral no disco).
   */
  requestRestore(checkpointIdRaw: unknown): CheckpointRestoreRequest {
    const checkpointId = requireNonEmptyString(checkpointIdRaw, "checkpointId");
    this.pendingCheckpointId = checkpointId;
    this.view = buildCheckpointRestoreView({
      phase: "idle",
      checkpointId,
      message: CHECKPOINT_RESTORE_IDLE_MESSAGE,
      restoredPaths: [],
      conflicts: [],
    });
    return {
      rpc: {
        method: RPC_METHOD.CHECKPOINT_RESTORE,
        params: { checkpointId },
      },
      view: this.view,
    };
  }

  /** Aplica o resultado RPC do daemon e atualiza a UI observável. */
  acceptOutcome(input: AcceptRestoreOutcomeInput): CheckpointRestoreViewSnapshot {
    if (!this.pendingCheckpointId) {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Nenhuma restauração pendente; chame requestRestore antes.",
        [],
      );
    }
    const checkpointId = this.pendingCheckpointId;
    const result = input.result;

    if ("restored" in result && result.restored === true) {
      const restoredPaths = normalizeRestoredPaths(input.restoredPaths);
      this.view = buildCheckpointRestoreView({
        phase: "restored",
        checkpointId,
        message: CHECKPOINT_RESTORE_OK_MESSAGE,
        restoredPaths,
        conflicts: [],
      });
      return this.view;
    }

    if ("conflict" in result && result.conflict === true) {
      const conflicts = normalizeConflictEntries(result.conflicts);
      this.view = buildCheckpointRestoreView({
        phase: "conflict",
        checkpointId,
        message: CHECKPOINT_RESTORE_CONFLICT_MESSAGE,
        restoredPaths: [],
        conflicts,
      });
      return this.view;
    }

    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Resultado de restore inválido para a UI.",
      ["result"],
    );
  }

  /** Enquanto houver conflito, gravação por cima permanece bloqueada. */
  assertOverwriteBlocked(): void {
    if (this.view.accessible.phase !== "conflict") {
      throw new ProtocolError(
        PROTOCOL_ERROR_CODES.INVALID_STATE,
        "Nenhum conflito de restore aberto para bloquear sobrescrita.",
        [this.view.accessible.phase],
      );
    }
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.CONFLICT,
      CHECKPOINT_RESTORE_CONFLICT_MESSAGE,
      this.view.accessible.conflicts.map((entry) =>
        JSON.stringify({
          path: entry.relativePath,
          currentContent: entry.currentContent,
          proposedContent: entry.proposedContent,
        }),
      ),
    );
  }

  dismiss(): void {
    this.pendingCheckpointId = null;
    this.view = buildCheckpointRestoreView({
      phase: "idle",
      checkpointId: null,
      message: CHECKPOINT_RESTORE_IDLE_MESSAGE,
      restoredPaths: [],
      conflicts: [],
    });
  }
}
