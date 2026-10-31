/** TAB-03: sugestao que altera outro arquivo mostra o caminho e so aplica apos revisao. */
import path from "node:path";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import {
  buildCrossFileSuggestionView,
  type CrossFileSuggestionPhase,
  type CrossFileSuggestionViewSnapshot,
} from "./cross-file-suggestion-view.js";

export type {
  CrossFileSuggestionPhase,
  CrossFileSuggestionViewSnapshot,
} from "./cross-file-suggestion-view.js";
export { buildCrossFileSuggestionView, crossFileStatusLabel } from "./cross-file-suggestion-view.js";

export interface CrossFileSuggestionPort {
  read(root: string, relativePath: string): Promise<string>;
  write(root: string, relativePath: string, content: string): Promise<void>;
}

export interface CrossFileSuggestionControllerOptions {
  root: string;
  port: CrossFileSuggestionPort;
}

export interface CrossFileOfferInput {
  relativePath: string;
  /** Novo conteudo completo depois da aplicacao. */
  proposedContent: string;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function normalizeRelativePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw invalidState("Caminho do arquivo sugerido invalido.", ["relativePath"]);
  }
  if (raw.includes("\0") || path.isAbsolute(raw) || raw.split("/").includes("..")) {
    throw invalidState("Caminho do arquivo sugerido fora do workspace.", [raw]);
  }
  return path.normalize(raw).replace(/\\/g, "/");
}

export class CrossFileSuggestionController {
  private readonly port: CrossFileSuggestionPort;
  private readonly root: string;
  private pendingOfferInFlight = false;
  private decideInFlight = false;
  private phase: CrossFileSuggestionPhase = "pending";
  private current: CrossFileOfferInput | null = null;
  private originalContent: string | null = null;
  private view: CrossFileSuggestionViewSnapshot;

  constructor(options: CrossFileSuggestionControllerOptions) {
    if (!options || typeof options.root !== "string" || options.root.length === 0) {
      throw invalidState("Root do workspace invalido para sugestao cross-file.", ["root"]);
    }
    if (!options.port || typeof options.port.read !== "function" || typeof options.port.write !== "function") {
      throw invalidState("Porta de leitura/escrita invalida para sugestao cross-file.", ["port"]);
    }
    this.root = options.root;
    this.port = options.port;
    this.view = this.buildView();
  }

  get snapshot(): CrossFileSuggestionViewSnapshot {
    return this.view;
  }

  /** Recebe uma sugerencia que altera outro arquivo; entra em revisao. */
  offer(input: CrossFileOfferInput): Promise<CrossFileSuggestionViewSnapshot> {
    if (this.pendingOfferInFlight) {
      throw invalidState("Outra oferta de sugestao cross-file esta em andamento.", [this.phase]);
    }
    if (this.phase === "reviewing") {
      throw invalidState("Ja existe uma sugestao em revisao.", [this.phase]);
    }
    const relativePath = normalizeRelativePath(input?.relativePath);
    if (typeof input?.proposedContent !== "string") {
      throw invalidState("Conteudo sugerido invalido.", ["proposedContent"]);
    }
    this.pendingOfferInFlight = true;
    return (async () => {
      try {
      this.current = { relativePath, proposedContent: input.proposedContent };
      this.phase = "reviewing";
      this.refreshView();
      this.originalContent = await this.port.read(this.root, relativePath);
      this.refreshView();
      return this.view;
      } catch (error) {
        // volta ao estado anterior na falha de leitura
        this.current = null;
        this.phase = "pending";
        this.refreshView();
        throw error;
      } finally {
        this.pendingOfferInFlight = false;
      }
    })();
  }

  /** Aplica a sugestao somente apos revisao (exige fase reviewing). */
  approve(): Promise<CrossFileSuggestionViewSnapshot> {
    if (this.decideInFlight) {
      throw invalidState("Outra decisao sobre a sugestao esta em andamento.", [this.phase]);
    }
    if (this.phase !== "reviewing" || !this.current || this.originalContent === null) {
      return Promise.reject(invalidState("Aprovar exige sugestao em revisao.", [this.phase]));
    }
    const offer = this.current;
    this.decideInFlight = true;
    return (async () => {
      try {
        await this.port.write(this.root, offer.relativePath, offer.proposedContent);
        this.phase = "approved";
        this.refreshView();
        return this.view;
      } catch (error) {
        // estado mantem reviewing em falha de escrita
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

  /** Rejeita a sugestao em revisao; o arquivo nao e alterado. */
  reject(): Promise<CrossFileSuggestionViewSnapshot> {
    if (this.decideInFlight) {
      throw invalidState("Outra decisao sobre a sugestao esta em andamento.", [this.phase]);
    }
    if (this.phase !== "reviewing") {
      return Promise.reject(invalidState("Rejeitar exige sugestao em revisao.", [this.phase]));
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

  /** Reinicia o fluxo; durante reviewing falha estavel. */
  reset(): CrossFileSuggestionViewSnapshot {
    if (this.phase === "reviewing") {
      throw invalidState("Reset exige fluxo terminado ou nunca iniciado.", [this.phase]);
    }
    this.phase = "pending";
    this.current = null;
    this.originalContent = null;
    this.refreshView();
    return this.view;
  }

  private refreshView(): void {
    this.view = this.buildView();
  }

  private buildView(): CrossFileSuggestionViewSnapshot {
    return buildCrossFileSuggestionView({
      phase: this.phase,
      root: this.root,
      relativePath: this.current?.relativePath ?? null,
      proposedContent: this.current?.proposedContent ?? null,
      originalContent: this.originalContent,
    });
  }
}
