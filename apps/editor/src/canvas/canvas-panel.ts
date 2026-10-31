/**
 * CAN-01: painel do canvas no editor — canvas aberto pelo agente aparece no
 * painel e persiste depois do fim da resposta. O conteúdo vem do CAS
 * (registro `{"kind":"canvas_artifact",...}`) por contentRef, lido pela porta
 * injetável do editor principal; nada chega por rede remota aqui.
 *
 * Estado observado por eventos do stream da run:
 * - `canvas.open`   → painel carrega e exibe o conteúdo do canvas;
 * - `run.completed` → fim da resposta: o canvas permanece visível.
 * A próxima mensagem usa um painel novo restaurado do estado da sessão.
 */

import {
  HarnessEventStreamController,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  validateHarnessEvent,
  type HarnessEvent,
} from "@openagent/protocol";

import {
  resolveCanvasPanelFocusNeighbor,
  resolveCanvasPanelKeyboardDirection,
  type CanvasPanelKeyboardEvent,
} from "./canvas-panel-keyboard.js";
import {
  CANVAS_PANEL_FOCUS_TARGETS,
  buildCanvasPanelView,
  type CanvasPanelArtifactRow,
  type CanvasPanelFocusTarget,
  type CanvasPanelUiPhase,
  type CanvasPanelViewSnapshot,
} from "./canvas-panel-view.js";
import type { CanvasArtifact } from "./index.js";

/** Evento emitido pelo daemon quando o agente abre um canvas na execução. */
export const CANVAS_OPEN_EVENT = "canvas.open";
/** Evento terminal da run: fim da resposta. */
export const RUN_COMPLETED_EVENT = "run.completed";

/** Porta de leitura do registro de canvas persistido no CAS. */
export interface CanvasArtifactPort {
  loadCanvasArtifact(contentRef: string): Promise<unknown> | unknown;
}

export interface CanvasPanelPushInput {
  event: unknown;
  payload?: unknown;
}

export interface CanvasPanelPushResult {
  view: CanvasPanelViewSnapshot;
  event: HarnessEvent;
}

/** Estado persistível do canvas por sessão (local, sem serviços remotos). */
export interface CanvasPanelSessionState {
  readonly artifacts: readonly CanvasArtifact[];
  /** true quando o canvas foi fechado durante a resposta e deve reaparecer. */
  readonly pendingReopen: boolean;
}

function invalidState(
  message: string,
  details: readonly string[] = [],
): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [
    ...details,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * CAN-01: QUANDO o agente abrir um canvas ENTÃO o painel exibe o conteúdo
 * e o mantém visível depois do fim da resposta.
 */
export class CanvasPanelController {
  private readonly stream: HarnessEventStreamController;
  private readonly sessionIdValue: string;
  private phase: CanvasPanelUiPhase = "idle";
  private storedArtifacts: CanvasArtifact[] = [];
  private activeCanvasId: string | null = null;
  private responseEnded = false;
  /** Canvas fechado durante a resposta: reaparece no prompt da próxima mensagem. */
  private pendingReopen = false;
  private errorMessage: string | null = null;
  /** contentRef do canvas.open que aguarda a leitura do CAS. */
  private pendingContentRef: string | null = null;
  /** canvasId do canvas.open que aguarda a leitura do CAS. */
  private pendingCanvasId: string | null = null;
  private focusedControl: CanvasPanelFocusTarget = CANVAS_PANEL_FOCUS_TARGETS[0];
  private view: CanvasPanelViewSnapshot;

  constructor(options: {
    runId: string;
    sessionId: string;
    /** Estado restaurado da sessão (persistência local por sessão/workspace). */
    restored?: CanvasPanelSessionState | null;
  }) {
    const { runId, sessionId, restored } = options;
    if (!isNonEmptyString(runId)) {
      throw invalidState("runId inválido para o painel do canvas.", ["runId"]);
    }
    if (!isNonEmptyString(sessionId)) {
      throw invalidState("sessionId inválido para o painel do canvas.", [
        "sessionId",
      ]);
    }
    this.sessionIdValue = sessionId;    this.stream = new HarnessEventStreamController({ runId: runId.trim() });
    if (restored !== undefined && restored !== null) {
      if (!isRecord(restored) || typeof restored["pendingReopen"] !== "boolean") {
        throw invalidState("Estado restaurado do canvas inválido.", [
          "restored",
        ]);
      }
      if (!Array.isArray(restored["artifacts"])) {
        throw invalidState("Estado restaurado do canvas inválido.", [
          "restored.artifacts",
        ]);
      }
      this.pendingReopen = restored["pendingReopen"];
      this.storedArtifacts = restored["artifacts"].map((artifact) =>
        this.validateArtifact(artifact),
      );
      const unique = new Set(this.storedArtifacts.map((item) => item.id));
      if (unique.size !== this.storedArtifacts.length) {
        throw invalidState("Estado restaurado do canvas inválido.", [
          "restored.artifacts.duplicado",
        ]);
      }
      if (this.pendingReopen && this.storedArtifacts.length > 0) {
        // Reaparece ao prompt da próxima mensagem.
        const last = this.storedArtifacts[this.storedArtifacts.length - 1];
        this.activeCanvasId = last?.id ?? null;
        this.phase = "open";
        this.pendingReopen = false;
      }
    }
    this.view = this.buildView();
  }

  get runId(): string {
    return this.stream.runId;
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get snapshot(): CanvasPanelViewSnapshot {
    return this.view;
  }

  /** Histórico completo de canvas desta sessão (ordem de abertura). */
  get artifacts(): readonly CanvasArtifact[] {
    return [...this.storedArtifacts];
  }

  /** Persistência local por sessão: exporta o estado do canvas. */
  exportSessionState(): CanvasPanelSessionState {
    return {
      artifacts: [...this.storedArtifacts],
      pendingReopen: this.pendingReopen,
    };
  }

  /**
   * Consume eco do stream da run: canvas.open (conteúdo no CAS),
   * run.completed (fim da resposta). A próxima mensagem restaura o painel
   * da sessão pelo estado persistido abaixo.
   */
  push(input: CanvasPanelPushInput): CanvasPanelPushResult {
    const eventCheck = validateHarnessEvent(input.event);
    if (!eventCheck.valid) {
      throw invalidState("HarnessEvent inválido.", eventCheck.errors);
    }
    const event = eventCheck.value;
    if (event.runId !== this.stream.runId) {
      throw invalidState(
        "runId do evento diverge da execução monitorada.",
        [event.runId, this.stream.runId],
      );
    }
    if (event.type === CANVAS_OPEN_EVENT) {
      this.acceptCanvasOpen(event, input.payload);
    } else if (event.type === RUN_COMPLETED_EVENT) {
      this.acceptRunCompleted(event);
    } else {
      throw invalidState("Tipo de evento não suportado no painel do canvas.", [
        event.type,
      ]);
    }
    this.refreshView();
    return { view: this.view, event };
  }

  /**
   * Lê o conteúdo do canvas no CAS pela porta do editor principal e exibe
   * no painel (fase “loading” → “open”).
   */
  async loadArtifact(
    port: CanvasArtifactPort,
    contentRef: unknown,
  ): Promise<{ view: CanvasPanelViewSnapshot }> {
    if (!isNonEmptyString(contentRef)) {
      throw invalidState("contentRef inválido para carregar canvas.", [
        "contentRef",
      ]);
    }
    if (this.pendingContentRef === null) {
      throw invalidState(
        "Nenhum canvas pendente de leitura na execução.",
        [this.phase],
      );
    }
    if (contentRef !== this.pendingContentRef) {
      throw invalidState(
        "Referência de conteúdo não corresponde ao canvas aberto.",
        [contentRef, this.pendingContentRef],
      );
    }
    let raw: unknown;
    try {
      raw = await port.loadCanvasArtifact(contentRef);
    } catch (error) {
      throw error instanceof ProtocolError
        ? error
        : invalidState("Conteúdo do canvas indisponível.", [String(error)]);
    }
    if (
      !isRecord(raw) ||
      raw["kind"] !== "canvas_artifact" ||
      !isRecord(raw["artifact"])
    ) {
      throw invalidState("Registro de canvas no CAS inválido.", ["artifact"]);
    }
    const artifact = this.validateArtifact(raw["artifact"]);
    if (this.pendingCanvasId !== null && artifact.id !== this.pendingCanvasId) {
      throw invalidState(
        "Identificação do canvas diverge do evento canvas.open.",
        [artifact.id, this.pendingCanvasId],
      );
    }
    const knownIndex = this.storedArtifacts.findIndex(
      (item) => item.id === artifact.id,
    );
    if (knownIndex >= 0) {
      const previous = this.storedArtifacts[knownIndex];
      this.storedArtifacts[knownIndex] = {
        ...artifact,
        createdAt: previous?.createdAt ?? artifact.createdAt,
      };
    } else {
      this.storedArtifacts.push(artifact);
    }
    this.activeCanvasId = artifact.id;
    this.errorMessage = null;
    this.pendingContentRef = null;
    this.pendingCanvasId = null;
    this.phase = "open";
    this.refreshView();
    return { view: this.view };
  }

  /** Fecha o canvas exibido; o conteúdo permanece no histórico da sessão. */
  closeCanvas(): { view: CanvasPanelViewSnapshot } {
    if (this.phase !== "open") {
      throw invalidState("Nenhum canvas aberto para fechar.", [this.phase]);
    }
    this.phase = "closed";
    this.pendingReopen = true;
    this.refreshView();
    return { view: this.view };
  }

  /** IPv-AGPN-15: conteúdo fechado permanece disponível no histórico. */
  openFromHistory(canvasId: unknown): { view: CanvasPanelViewSnapshot } {
    if (!isNonEmptyString(canvasId)) {
      throw invalidState("Identificação do canvas inválida.", ["canvasId"]);
    }
    const artifact = this.storedArtifacts.find((item) => item.id === canvasId);
    if (artifact === undefined) {
      throw invalidState("Canvas não presente no histórico da sessão.", [
        canvasId,
      ]);
    }
    this.activeCanvasId = artifact.id;
    this.errorMessage = null;
    this.phase = "open";
    this.refreshView();
    return { view: this.view };
  }

  /** UI-01: move o foco de teclado para um alvo nomeado do painel. */
  setFocusedControl(control: unknown): CanvasPanelViewSnapshot {
    if (
      typeof control !== "string" ||
      !CANVAS_PANEL_FOCUS_TARGETS.includes(control as CanvasPanelFocusTarget)
    ) {
      throw invalidState("Alvo de foco inválido no painel do canvas.", [
        String(control),
      ]);
    }
    this.focusedControl = control as CanvasPanelFocusTarget;
    this.refreshView();
    return this.view;
  }

  /** IPv-AGPN-15: canvas aberto é focável e navegável por teclado.
   *  Sem conteúdo no histórico, o botão de fechar não existe no painel e não
   *  entra no ciclo de foco. */
  handleKeyboard(event: CanvasPanelKeyboardEvent): CanvasPanelViewSnapshot {
    const direction = resolveCanvasPanelKeyboardDirection(event);
    const targets: readonly CanvasPanelFocusTarget[] =
      this.storedArtifacts.length === 0
        ? (CANVAS_PANEL_FOCUS_TARGETS.filter(
            (target: CanvasPanelFocusTarget) =>
              target !== "canvas-close-button",
          ) as CanvasPanelFocusTarget[])
        : CANVAS_PANEL_FOCUS_TARGETS;
    this.focusedControl = resolveCanvasPanelFocusNeighbor(
      this.focusedControl,
      targets,
      direction,
    );
    this.refreshView();
    return this.view;
  }

  private acceptCanvasOpen(event: HarnessEvent, rawPayload: unknown): void {
    if (this.responseEnded) {
      throw invalidState(
        "Resposta da execução já encerrada: canvas pertence à próxima execução.",
        [RUN_COMPLETED_EVENT],
      );
    }
    if (this.phase === "loading" || this.pendingContentRef !== null) {
      throw invalidState("Abertura de canvas já em andamento.", [this.phase]);
    }
    if (!isRecord(rawPayload)) {
      throw invalidState("Payload do evento canvas.open inválido.", [
        "payload",
      ]);
    }
    const canvasId = rawPayload["canvasId"];
    const title = rawPayload["title"];
    const contentRef = rawPayload["contentRef"];
    if (!isNonEmptyString(canvasId)) {
      throw invalidState("Identificação do canvas ausente ou inválida.", [
        "canvasId",
      ]);
    }
    if (!isNonEmptyString(title)) {
      throw invalidState("Título do canvas ausente ou inválido.", ["title"]);
    }
    if (!isNonEmptyString(contentRef)) {
      throw invalidState("Referência de conteúdo do canvas ausente.", [
        "contentRef",
      ]);
    }
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(
        pushResult.code,
        "Evento canvas.open rejeitado pelo stream.",
        [
          ...pushResult.code === PROTOCOL_ERROR_CODES.INVALID_STATE
            ? pushResult.errors
            : [],
        ],
      );
    }
    this.pendingContentRef = contentRef;
    this.pendingCanvasId = canvasId;
    this.phase = "loading";
  }

  private acceptRunCompleted(event: HarnessEvent): void {
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(
        pushResult.code,
        "Evento run.completed rejeitado pelo stream.",
        [
          ...pushResult.code === PROTOCOL_ERROR_CODES.INVALID_STATE
            ? pushResult.errors
            : [],
        ],
      );
    }
    // CAN-01: canvas permanece visível depois do fim da resposta; nenhum
    // conteúdo é removido ou recarregado.
    this.responseEnded = true;
    if (this.phase === "loading") {
      // Fim da resposta mantém a leitura pendente visível com mensagem explícita.
      this.errorMessage = "Resposta encerrada enquanto o conteúdo era carregado.";
    }
    this.refreshView();
  }

  private validateArtifact(raw: unknown): CanvasArtifact {
    if (!isRecord(raw)) {
      throw invalidState("Conteúdo de canvas inválido.", ["artifact"]);
    }
    const id = raw["id"];
    const title = raw["title"];
    const content = raw["content"];
    if (!isNonEmptyString(id)) {
      throw invalidState("Identificação do canvas ausente ou inválida.", [
        "artifact.id",
      ]);
    }
    if (!isNonEmptyString(title)) {
      throw invalidState("Título do canvas ausente ou inválido.", [
        "artifact.title",
      ]);
    }
    if (typeof content !== "string" || content.length === 0) {
      throw invalidState("Conteúdo do canvas ausente ou inválido.", [
        "artifact.content",
      ]);
    }
    return {
      id,
      title,
      content,
      createdAt: typeof raw["createdAt"] === "number"
        ? raw["createdAt"]
        : Date.now(),
      updatedAt: typeof raw["updatedAt"] === "number"
        ? raw["updatedAt"]
        : Date.now(),
    };
  }

  private rowFor(artifact: CanvasArtifact): CanvasPanelArtifactRow {
    return {
      id: artifact.id,
      title: artifact.title,
      content: artifact.content,
      openedThisRun: false,
    };
  }

  private buildView(): CanvasPanelViewSnapshot {
    const active = this.activeCanvasId === null
      ? null
      : (this.storedArtifacts.find(
          (item) => item.id === this.activeCanvasId,
        ) ?? null);
    return buildCanvasPanelView({
      runId: this.stream.runId,
      sessionId: this.sessionIdValue,
      phase: this.phase,
      activeArtifact: active === null ? null : this.rowFor(active),
      artifacts: this.storedArtifacts.map((artifact) => this.rowFor(artifact)),
      responseEnded: this.responseEnded,
      focused: this.focusedControl,
      errorMessage: this.errorMessage,
    });
  }

  private refreshView(): void {
    this.view = this.buildView();
  }
}
