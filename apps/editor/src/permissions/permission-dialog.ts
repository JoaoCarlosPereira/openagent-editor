import {
  RunToolPermissionFlow,
  formatPermissionPromptForDisplay,
  validateGrantScope,
  type GrantScopeKind,
  type PermissionDecision,
  type RunToolPermissionPrepareResult,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

import {
  buildPermissionDialogView,
  type PermissionDialogViewSnapshot,
} from "./permission-dialog-view.js";

export type { PermissionDialogViewSnapshot } from "./permission-dialog-view.js";
export { buildPermissionDialogView } from "./permission-dialog-view.js";

export interface PermissionDialogSubmitInput {
  decision: PermissionDecision;
  selectedScope: unknown;
}

export interface PermissionDialogOpenState {
  requestId: string;
  runId: string;
  sessionId: string;
  offeredScopes: readonly GrantScopeKind[];
  selectedScope: GrantScopeKind;
  view: PermissionDialogViewSnapshot;
}

/**
 * PER-01: diálogo com ação, alvo, escopo e degradação; execução só após aceite explícito.
 */
export class PermissionDialogController {
  private readonly flow: RunToolPermissionFlow;
  private openState: PermissionDialogOpenState | undefined;

  constructor(flow?: RunToolPermissionFlow) {
    this.flow = flow ?? new RunToolPermissionFlow();
  }

  get runPermissionFlow(): RunToolPermissionFlow {
    return this.flow;
  }

  get isOpen(): boolean {
    return this.openState !== undefined;
  }

  openFromPrepared(
    context: { runId: string; sessionId: string },
    prepared: Extract<RunToolPermissionPrepareResult, { phase: "pending" }>,
  ): PermissionDialogOpenState {
    const selectedScope = prepared.request.offeredScopes[0] ?? "once";
    const display = formatPermissionPromptForDisplay(prepared.gate.prompt);
    const view = buildPermissionDialogView({
      requestId: prepared.request.requestId,
      action: display.action,
      target: display.target,
      offeredScopes: prepared.request.offeredScopes,
      selectedScope,
      ...(display.degradationNotice ? { degradationNotice: display.degradationNotice } : {}),
      ...(display.sandboxIsolationLevel
        ? { sandboxIsolationLevel: display.sandboxIsolationLevel }
        : {}),
    });
    this.openState = {
      requestId: prepared.request.requestId,
      runId: context.runId,
      sessionId: context.sessionId,
      offeredScopes: prepared.request.offeredScopes,
      selectedScope,
      view,
    };
    return this.openState;
  }

  selectScope(scope: unknown): PermissionDialogViewSnapshot {
    const state = this.requireOpen();
    const scopeResult = validateGrantScope(scope);
    if (!scopeResult.valid) {
      throw new ProtocolError("INVALID_STATE", "Escopo selecionado inválido.", scopeResult.errors);
    }
    if (!state.offeredScopes.includes(scopeResult.value)) {
      throw new ProtocolError("INVALID_STATE", "Escopo selecionado não está entre os escopos oferecidos.", [
        `selectedScope=${String(scope)}`,
      ]);
    }
    state.selectedScope = scopeResult.value;
    const pending = this.flow.getPending(state.requestId);
    if (!pending) {
      throw new ProtocolError("INVALID_STATE", "Pedido de permissão não encontrado.", [
        `requestId=${state.requestId}`,
      ]);
    }
    state.view = buildPermissionDialogView({
      requestId: state.requestId,
      action: state.view.accessible.action,
      target: state.view.accessible.target,
      offeredScopes: state.offeredScopes,
      selectedScope: state.selectedScope,
      ...(state.view.accessible.degradationNotice
        ? { degradationNotice: state.view.accessible.degradationNotice }
        : {}),
    });
    return state.view;
  }

  /** Aceite ou recusa explícita; fecha o diálogo e delega ao fluxo PER-01 do daemon. */
  submit(input: PermissionDialogSubmitInput): {
    canExecute: boolean;
    decision: PermissionDecision;
    selectedScope: GrantScopeKind;
  } {
    const state = this.requireOpen();
    const scopeResult = validateGrantScope(input.selectedScope);
    if (!scopeResult.valid) {
      throw new ProtocolError("INVALID_STATE", "Escopo selecionado inválido.", scopeResult.errors);
    }
    const resolved = this.flow.decide(state.requestId, input.decision, scopeResult.value);
    this.openState = undefined;
    return {
      canExecute: resolved.canExecute,
      decision: input.decision,
      selectedScope: scopeResult.value,
    };
  }

  closeWithoutDecision(): void {
    this.openState = undefined;
  }

  currentView(): PermissionDialogViewSnapshot | undefined {
    return this.openState?.view;
  }

  private requireOpen(): PermissionDialogOpenState {
    if (!this.openState) {
      throw new ProtocolError("INVALID_STATE", "Nenhum diálogo de permissão aberto.", []);
    }
    return this.openState;
  }
}
