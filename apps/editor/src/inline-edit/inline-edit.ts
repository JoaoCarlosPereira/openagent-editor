/** INL-01: Inline Edit na selecao/insercao com diff, aceitar, rejeitar e refinar. */
import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import {
  buildInlineEditView,
  type InlineEditMode,
  type InlineEditPhase,
  type InlineEditViewSnapshot,
} from "./inline-edit-view.js";

export {
  buildInlineEditView,
  computeInlineEditDiff,
  inlineEditStatusLabel,
  type InlineEditMode,
  type InlineEditDiffRow,
  type InlineEditDiffRowKind,
  type InlineEditPhase,
  type InlineEditViewSnapshot,
} from "./inline-edit-view.js";

/** Limites de contexto herdados do comportamento de extension/inline.js. */
export const INLINE_EDIT_CONTEXT_PREFIX_LIMIT = 1600;
export const INLINE_EDIT_CONTEXT_SUFFIX_LIMIT = 800;

export interface InlineEditGenerateResult {
  content: string;
}

export interface InlineEditGenerateInput {
  instruction: string;
  /** Texto original da selecao; vazio na insercao no cursor. */
  originalText: string;
  prefix: string;
  suffix: string;
  mode: InlineEditMode;
  /**
   * Proposta em revisao que origina este pedido de refino; ausente na
   * geracao inicial. Garante que o refino parte do diff existente.
   */
  previousProposal?: string;
}

export interface InlineEditApplyEdit {
  start: number;
  end: number;
  replacement: string;
}

/** Porta do editor/daemon: gera a proposta e aplica o resultado revisado. */
export interface InlineEditPort {
  generate(input: InlineEditGenerateInput): Promise<InlineEditGenerateResult>;
  apply(edit: InlineEditApplyEdit): Promise<void>;
}

export interface InlineEditControllerOptions {
  port: InlineEditPort;
}

export interface InlineEditRequestInput {
  instruction: string;
  document: string;
  start: number;
  end: number;
}

interface InlineEditCurrent {
  document: string;
  start: number;
  end: number;
  mode: InlineEditMode;
  originalText: string;
  proposal: string | null;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function validateTarget(document: string, start: number, end: number): void {
  if (typeof document !== "string") {
    throw invalidState("Documento do editor invalido.", ["document"]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0) {
    throw invalidState("Indices do cursor invalidos.", [String(start), String(end)]);
  }
  if (start > end || end > document.length) {
    throw invalidState("Selecao do cursor fora do documento.", [
      String(start),
      String(end),
      String(document.length),
    ]);
  }
}

/**
 * INL-01: fluxo idle -> generating -> reviewing -> accepted | rejected,
 * com refine mantendo revisao e o original preservado.
 */
export class InlineEditController {
  private readonly port: InlineEditPort;
  private generationInFlight = false;
  private decideInFlight = false;
  private phase: InlineEditPhase = "idle";
  private refinementCount = 0;
  private current: InlineEditCurrent | null = null;
  private view: InlineEditViewSnapshot;

  constructor(options: InlineEditControllerOptions) {
    if (
      !options ||
      !options.port ||
      typeof options.port.generate !== "function" ||
      typeof options.port.apply !== "function"
    ) {
      throw invalidState("Porta de geracao/aplicacao invalida para Inline Edit.", ["port"]);
    }
    this.port = options.port;
    this.view = this.buildView();
  }

  get snapshot(): InlineEditViewSnapshot {
    return this.view;
  }

  /** Documento alvo permanecido no controller (o editor aplica via port). */
  get document(): string | null {
    return this.current?.document ?? null;
  }

  /** Pede Inline Edit sobre a selecao [start, end) do documento. */
  request(input: InlineEditRequestInput): Promise<InlineEditViewSnapshot> {
    if (this.generationInFlight) {
      throw invalidState("Outra geracao de edicao inline esta em andamento.", [this.phase]);
    }
    if (this.phase === "generating" || this.phase === "refining" || this.phase === "reviewing") {
      throw invalidState("Ja existe edicao inline em andamento ou em revisao.", [this.phase]);
    }
    if (typeof input?.instruction !== "string" || input.instruction.trim().length === 0) {
      throw invalidState("Instrucao da edicao inline invalida.", ["instruction"]);
    }
    validateTarget(input?.document, input?.start, input?.end);
    const previous = this.current;
    const previousPhase = this.phase;
    this.generationInFlight = true;
    return (async () => {
      try {
        const { document, start, end, instruction } = input;
        const mode: InlineEditMode = start < end ? "selection" : "insert";
        const originalText = document.slice(start, end);
        const prefix = document.slice(
          Math.max(0, start - INLINE_EDIT_CONTEXT_PREFIX_LIMIT),
          start,
        );
        const suffix = document.slice(end, end + INLINE_EDIT_CONTEXT_SUFFIX_LIMIT);
        this.current = { document, start, end, mode, originalText, proposal: null };
        this.phase = "generating";
        this.refinementCount = 0;
        this.refreshView();
        const proposal = await this.port.generate({
          instruction,
          originalText,
          prefix,
          suffix,
          mode,
        });
        if (typeof proposal?.content !== "string") {
          throw invalidState("Proposta da edicao inline invalida.", ["content"]);
        }
        this.current.proposal = proposal.content;
        this.phase = "reviewing";
        this.refreshView();
        return this.view;
      } catch (error) {
        // restaura o estado anterior (idle/accepted/rejected); nada e escrito em falha
        this.current = previous;
        this.phase = previousPhase;
        this.refreshView();
        throw error;
      } finally {
        this.generationInFlight = false;
      }
    })();
  }

  /** Aceita a revisao: aplica a substituicao alvo por a port e encerra em accepted. */
  accept(): Promise<InlineEditViewSnapshot> {
    if (this.decideInFlight) {
      throw invalidState("Outra decisao sobre a edicao inline esta em andamento.", [this.phase]);
    }
    const current = this.current;
    if (
      this.phase !== "reviewing" ||
      !current ||
      typeof current.proposal !== "string"
    ) {
      return Promise.reject(invalidState("Aceitar exige edicao inline em revisao.", [this.phase]));
    }
    const replacement: string = current.proposal;
    this.decideInFlight = true;
    return (async () => {
      try {
        await this.port.apply({ start: current.start, end: current.end, replacement });
        this.phase = "accepted";
        this.refreshView();
        return this.view;
      } catch (error) {
        // proposta permanece em revisao na falha de aplicacao
        if (this.phase !== "reviewing") {
          this.phase = "reviewing";
          this.refreshView();
        }
        throw error;
      } finally {
        this.decideInFlight = false;
      }
    })();
  }

  /** Rejeita a revisao; o texto original permanece e nada e escrito. */
  reject(): Promise<InlineEditViewSnapshot> {
    if (this.decideInFlight) {
      throw invalidState("Outra decisao sobre a edicao inline esta em andamento.", [this.phase]);
    }
    if (this.phase !== "reviewing") {
      return Promise.reject(invalidState("Rejeitar exige edicao inline em revisao.", [this.phase]));
    }
    this.decideInFlight = true;
    return (async () => {
      try {
        this.phase = "rejected";
        this.refreshView();
        return this.view;
      } finally {
        this.decideInFlight = false;
      }
    })();
  }

  /** Refina com nova instrucao; o original e a revisao ficam preservados em falha. */
  refine(instruction: string): Promise<InlineEditViewSnapshot> {
    if (this.generationInFlight) {
      throw invalidState("Outra geracao de edicao inline esta em andamento.", [this.phase]);
    }
    if (this.phase !== "reviewing" || !this.current || this.current.proposal === null) {
      return Promise.reject(invalidState("Refinar exige edicao inline em revisao.", [this.phase]));
    }
    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      throw invalidState("Instrucao de refinamento invalida.", ["instruction"]);
    }
    const editing = this.current;
    if (editing === null || editing.proposal === null) {
      return Promise.reject(invalidState("Refinar exige edicao inline em revisao.", [this.phase]));
    }
    this.generationInFlight = true;
    return (async () => {
      try {
        const refined: InlineEditCurrent = {
          document: editing.document,
          start: editing.start,
          end: editing.end,
          mode: editing.mode,
          originalText: editing.originalText,
          proposal: null,
        };
        this.current = refined;
        this.phase = "refining";
        this.refreshView();
        const proposal = await this.port.generate({
          instruction,
          originalText: refined.originalText,
          prefix: refined.document.slice(
            Math.max(0, refined.start - INLINE_EDIT_CONTEXT_PREFIX_LIMIT),
            refined.start,
          ),
          suffix: refined.document.slice(refined.end, refined.end + INLINE_EDIT_CONTEXT_SUFFIX_LIMIT),
          mode: refined.mode,
          // o refino parte do diff existente: a proposta em revisao acompanha
          previousProposal: editing.proposal ?? undefined,
        });
        if (typeof proposal?.content !== "string") {
          throw invalidState("Proposta da edicao inline invalida.", ["content"]);
        }
        refined.proposal = proposal.content;
        this.refinementCount += 1;
        this.phase = "reviewing";
        this.refreshView();
        return this.view;
      } catch (error) {
        // restaura a proposta anterior da revisao em falha de refino
        this.current = editing;
        this.phase = "reviewing";
        this.refreshView();
        throw error;
      } finally {
        this.generationInFlight = false;
      }
    })();
  }

  /** Reinicia o fluxo terminado ou nunca iniciado. */
  reset(): InlineEditViewSnapshot {
    if (this.phase !== "idle" && this.phase !== "accepted" && this.phase !== "rejected") {
      throw invalidState("Reset exige edicao inline terminada ou nunca iniciada.", [this.phase]);
    }
    this.phase = "idle";
    this.current = null;
    this.refinementCount = 0;
    this.refreshView();
    return this.view;
  }

  private buildView(): InlineEditViewSnapshot {
    return buildInlineEditView({
      phase: this.phase,
      mode: this.current?.mode ?? null,
      proposal: this.current?.proposal ?? null,
      originalText: this.current?.originalText ?? null,
      refinementCount: this.refinementCount,
    });
  }

  private refreshView(): void {
    this.view = this.buildView();
  }
}
