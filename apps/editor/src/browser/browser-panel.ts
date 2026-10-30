/**
 * AUT-01: painel do navegador no editor, ligado ao canal browser RPC do daemon.
 *
 * tool.invoke (browser.open / browser.click) + permission.decide decidido por
 * permissionRequestId + evento tool.result do stream da run com a evidência
 * (captura PNG e console) lida por resultRef do CAS, via porta injetável do
 * editor principal; browser.open.failed mostra a falha preservando a evidência.
 */

import {
  validateBrowserUrl,
  type BrowserConsoleLogEntry,
} from "@openagent/tools";
import {
  HarnessEventStreamController,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  RPC_METHOD,
  validateHarnessEvent,
  type HarnessEvent,
  type RpcParamsMap,
} from "@openagent/protocol";

import {
  buildBrowserPanelView,
  type BrowserPanelEvidenceRow,
  type BrowserPanelUiPhase,
  type BrowserPanelViewSnapshot,
} from "./browser-panel-view.js";

export type {
  BrowserPanelEvidenceRow,
  BrowserPanelLastInteraction,
  BrowserPanelUiPhase,
  BrowserPanelViewSnapshot,
} from "./browser-panel-view.js";
export { buildBrowserPanelView, browserPanelStatusLabel } from "./browser-panel-view.js";

/** Evento emitido pelo daemon quando a execução autorizada do navegador falha (task_175). */
export const BROWSER_OPEN_FAILED_EVENT = "browser.open.failed";

/** Evento da run com a referência (CAS) da evidência do navegador (task_175). */
export const TOOL_RESULT_EVENT = "tool.result";

export type BrowserPanelPermissionPrompt = {
  action: string;
  target: string;
  scopeLabel: string;
};

/** Porta de leitura do resultado persistido no CAS (blob `{"kind":"tool_result",...}`). */
export interface BrowserPanelResultPort {
  loadToolResult(resultRef: string): Promise<unknown> | unknown;
}

export interface BrowserPanelPushResult {
  view: BrowserPanelViewSnapshot;
  /** resultRef do último tool.result (browser.open/click); null em outros caminhos. */
  resultRef: string | null;
  event: HarnessEvent;
}

export interface BrowserPanelPushInput {
  event: unknown;
  payload?: unknown;
}

function invalidState(message: string, details: readonly string[] = []): ProtocolError {
  return new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, [...details]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * AUT-01: QUANDO a pessoa autorizar o navegador ENTÃO o produto abre a URL indicada,
 * executa a interação autorizada e mostra a captura e o texto de console.
 *
 * O controller é síncrono: as chamadas RPC (invokeTool/decide) e a leitura da
 * evidência no CAS (loadToolResult, via porta) são feitas pelo chamador; o estado
 * da UI avança com acceptPermissionPrompt/submitDecision/push/loadEvidence.
 */
export class BrowserPanelController {
  private readonly stream: HarnessEventStreamController;
  private readonly sessionIdValue: string;
  private phase: BrowserPanelUiPhase = "idle";
  private lastRequestedUrl = "";
  private pendingPermissionRequestId: string | null = null;
  private pendingPrompt: BrowserPanelPermissionPrompt | null = null;
  private evidenceRow: BrowserPanelEvidenceRow | null = null;
  private errorMessage: string | null = null;
  private lastResultRefValue: string | null = null;
  private view: BrowserPanelViewSnapshot;

  constructor(options: { runId: string; sessionId: string }) {
    const { runId, sessionId } = options;
    if (!isNonEmptyString(runId)) {
      throw invalidState("runId inválido para o painel do navegador.", ["runId"]);
    }
    if (!isNonEmptyString(sessionId)) {
      throw invalidState("sessionId inválido para o painel do navegador.", ["sessionId"]);
    }
    this.sessionIdValue = sessionId;
    this.stream = new HarnessEventStreamController({ runId: runId.trim() });
    this.view = this.buildView();
  }

  get runId(): string {
    return this.stream.runId;
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get snapshot(): BrowserPanelViewSnapshot {
    return this.view;
  }

  get lastResultRef(): string | null {
    return this.lastResultRefValue;
  }

  /**
   * Pedido de UI: abrir uma URL no navegador autorizado. Valida a entrada com a
   * mesma policy do daemon (códigos estáveis) antes de devolver o RPC.
   */
  requestOpen(rawUrl: unknown): {
    rpc: {
      method: typeof RPC_METHOD.TOOL_INVOKE;
      params: RpcParamsMap[typeof RPC_METHOD.TOOL_INVOKE];
    };
    view: BrowserPanelViewSnapshot;
  } {
    if (this.phase === "pending" || this.phase === "loading") {
      throw invalidState(
        "Autorização de navegador já em andamento para esta execução.",
        [this.phase],
      );
    }
    // Reusa a policy de browser da task_174 (URL ausente → INVALID_STATE;
    // esquema/credencial fora do escopo → OUT_OF_SCOPE).
    const validatedUrl = validateBrowserUrl(rawUrl);
    this.lastRequestedUrl = validatedUrl;
    this.refreshView();
    return {
      rpc: {
        method: RPC_METHOD.TOOL_INVOKE,
        params: {
          tool: "browser.open",
          target: validatedUrl,
          arguments: {},
        },
      },
      view: this.view,
    };
  }

  /**
   * Acata o `pending` do daemon para tool.invoke browser: exibe o prompt
   * (ação/alvo/escopo) com botões de decisão.
   */
  acceptPermissionPrompt(
    permissionRequestId: unknown,
    prompt: unknown,
  ): { view: BrowserPanelViewSnapshot } {
    if (!isNonEmptyString(permissionRequestId)) {
      throw invalidState("permissionRequestId inválido.", ["permissionRequestId"]);
    }
    if (this.phase === "pending") {
      throw invalidState("Já existe uma decisão pendente de autorização.", [
        this.pendingPermissionRequestId ?? "",
      ]);
    }
    if (!isRecord(prompt)) {
      throw invalidState("Prompt de permissão inválido.", ["prompt"]);
    }
    const action = prompt["action"];
    const target = prompt["target"];
    const scopeLabel = prompt["scopeLabel"];
    if (!isNonEmptyString(action) || !isNonEmptyString(target) || !isNonEmptyString(scopeLabel)) {
      throw invalidState("Prompt de permissão incompleto.", ["prompt"]);
    }
    this.pendingPermissionRequestId = permissionRequestId;
    this.pendingPrompt = { action, target, scopeLabel };
    this.errorMessage = null;
    this.phase = "pending";
    this.refreshView();
    return { view: this.view };
  }

  /**
   * Decisão da pessoa: `allow` aguarda o eco tool.result; `deny` mostra a recusa.
   * Devolve o RPC permission.decide com escopo fixo "once" (uma ação por vez).
   */
  submitDecision(decision: unknown): {
    rpc: {
      method: typeof RPC_METHOD.PERMISSION_DECIDE;
      params: RpcParamsMap[typeof RPC_METHOD.PERMISSION_DECIDE];
    };
    view: BrowserPanelViewSnapshot;
  } {
    if (this.phase !== "pending" || !this.pendingPermissionRequestId) {
      throw invalidState("Nenhuma autorização do navegador pendente de decisão.", [
        this.phase,
      ]);
    }
    if (decision !== "allow" && decision !== "deny") {
      throw invalidState("Decisão de autorização inválida.", [String(decision)]);
    }
    const typedDecision = decision as "allow" | "deny";
    const permissionRequestId = this.pendingPermissionRequestId;
    // Consumo único: decisão já enviada não pode ser reenviada (daemon rejeita pedido reaproveitado).
    this.pendingPermissionRequestId = null;
    this.pendingPrompt = null;
    if (typedDecision === "deny") {
      this.phase = "denied";
    }
    this.refreshView();
    return {
      rpc: {
        method: RPC_METHOD.PERMISSION_DECIDE,
        params: {
          permissionRequestId,
          decision: typedDecision,
          scope: "once",
        },
      },
      view: this.view,
    };
  }

  /**
   * INTERAÇÃO autorizada no mesmo target autorizado: tool.invoke browser.click.
   * Exige sessão de navegador já aprovada e com evidência de abertura.
   */
  requestClick(rawSelector: unknown): {
    rpc: {
      method: typeof RPC_METHOD.TOOL_INVOKE;
      params: RpcParamsMap[typeof RPC_METHOD.TOOL_INVOKE];
    };
    view: BrowserPanelViewSnapshot;
  } {
    if (this.phase === "pending" || this.phase === "loading") {
      throw invalidState("Autorização de navegador já em andamento.", [this.phase]);
    }
    if (this.phase !== "evidence" || this.evidenceRow === null) {
      throw invalidState(
        "Nenhum navegador autorizado aberto para interagir nesta execução.",
        [this.phase],
      );
    }
    if (!isNonEmptyString(rawSelector)) {
      throw invalidState("Seletor da interação do navegador inválido.", ["selector"]);
    }
    return {
      rpc: {
        method: RPC_METHOD.TOOL_INVOKE,
        params: {
          tool: "browser.click",
          target: this.evidenceRow.url,
          arguments: { selector: rawSelector.trim() },
        },
      },
      view: this.view,
    };
  }

  /**
   * Consume eco do stream da run: tool.result (evidência disponível no CAS)
   * ou browser.open.failed (falha preservando a evidência anterior).
   */
  push(input: BrowserPanelPushInput): BrowserPanelPushResult {
    const eventCheck = validateHarnessEvent(input.event);
    if (!eventCheck.valid) {
      throw invalidState("HarnessEvent inválido.", eventCheck.errors);
    }
    const event = eventCheck.value;
    if (event.runId !== this.stream.runId) {
      throw invalidState("runId do evento diverge da execução monitorada.", [
        event.runId,
        this.stream.runId,
      ]);
    }
    if (event.type === TOOL_RESULT_EVENT) {
      this.acceptToolResult(event, input.payload);
      this.refreshView();
      return { view: this.view, resultRef: this.lastResultRefValue, event };
    }
    if (event.type === BROWSER_OPEN_FAILED_EVENT) {
      this.acceptOpenFailed(event, input.payload);
      this.refreshView();
      return { view: this.view, resultRef: null, event };
    }
    throw invalidState("Tipo de evento não suportado no painel do navegador.", [
      event.type,
    ]);
  }

  /**
   * Lê a evidência do tool.result no CAS pela porta do editor principal
   * e exibe captura e console.
   */
  async loadEvidence(
    port: BrowserPanelResultPort,
    resultRef: unknown,
  ): Promise<{ view: BrowserPanelViewSnapshot }> {
    if (!isNonEmptyString(resultRef)) {
      throw invalidState("resultRef inválido para carregar evidência.", ["resultRef"]);
    }
    if (this.lastResultRefValue !== null && resultRef !== this.lastResultRefValue) {
      throw invalidState(
        "Evidência solicitada não corresponde ao último tool.result.",
        [resultRef, this.lastResultRefValue],
      );
    }
    let raw: unknown;
    try {
      raw = await port.loadToolResult(resultRef);
    } catch (error) {
      throw error instanceof ProtocolError
        ? error
        : invalidState("Resultado do navegador indisponível.", [String(error)]);
    }
    if (!isRecord(raw) || raw["kind"] !== "tool_result" || !isRecord(raw["result"])) {
      throw invalidState("Registro de resultado do navegador inválido.", ["result"]);
    }
    const evidence = this.validateEvidencePayload(raw["result"]);
    this.evidenceRow = evidence;
    this.lastResultRefValue = resultRef;
    this.errorMessage = null;
    this.phase = "evidence";
    this.refreshView();
    return { view: this.view };
  }

  private acceptToolResult(event: HarnessEvent, rawPayload: unknown): void {
    if (this.phase === "idle" || this.phase === "denied") {
      throw invalidState(
        "tool.result exige um pedido de navegador previamente autorizado.",
        [this.phase],
      );
    }
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(
        pushResult.code,
        "Evento tool.result rejeitado pelo stream.",
        [...(pushResult.code === PROTOCOL_ERROR_CODES.INVALID_STATE ? pushResult.errors : [])],
      );
    }
    if (!isRecord(rawPayload)) {
      throw invalidState("Payload do evento tool.result inválido.", ["payload"]);
    }
    const invocation = rawPayload["invocation"];
    if (!isRecord(invocation) || !isNonEmptyString(invocation["resultRef"])) {
      throw invalidState("resultRef ausente no resultado da ferramenta.", ["resultRef"]);
    }
    if (invocation["state"] !== "completed") {
      throw invalidState(
        "Resultado do navegador em estado não concluído.",
        [String(invocation["state"])],
      );
    }
    this.lastResultRefValue = String(invocation["resultRef"]);
    this.phase = "loading";
  }

  private acceptOpenFailed(event: HarnessEvent, rawPayload: unknown): void {
    const pushResult = this.stream.push(event);
    if (!pushResult.accepted) {
      throw new ProtocolError(
        pushResult.code,
        "Evento browser.open.failed rejeitado pelo stream.",
        [...(pushResult.code === PROTOCOL_ERROR_CODES.INVALID_STATE ? pushResult.errors : [])],
      );
    }
    const message =
      isRecord(rawPayload) && isNonEmptyString(rawPayload["message"])
        ? String(rawPayload["message"])
        : "Execução do navegador falhou.";
    this.errorMessage = message;
    this.phase = "failed";
  }

  private validateEvidencePayload(result: Record<string, unknown>): BrowserPanelEvidenceRow {
    const tool = result["tool"];
    if (tool !== "browser.open" && tool !== "browser.click") {
      throw invalidState("Ferramenta do navegador não suportada no resultado.", [
        String(tool),
      ]);
    }
    const url = result["url"];
    const screenshot = result["screenshot"];
    const screenshotMimeType = result["screenshotMimeType"];
    const consoleLogs = result["consoleLogs"];
    if (!isNonEmptyString(url) || !isNonEmptyString(screenshot)) {
      throw invalidState("Captura ou URL ausente no resultado do navegador.", ["evidência"]);
    }
    if (screenshotMimeType !== "image/png") {
      throw invalidState("Formato de captura não suportado.", [String(screenshotMimeType)]);
    }
    if (!Array.isArray(consoleLogs)) {
      throw invalidState("Console ausente no resultado do navegador.", ["consoleLogs"]);
    }
    const title = isNonEmptyString(result["title"]) ? String(result["title"]) : url;
    const logs: BrowserConsoleLogEntry[] = consoleLogs.map((entry) => {
      if (!isRecord(entry) || !isNonEmptyString(entry["text"])) {
        throw invalidState("Entrada de console inválida.", ["consoleLogs"]);
      }
      const type = entry["type"];
      const acceptsType =
        type === "log" || type === "warn" || type === "error" ||
        type === "info" || type === "debug";
      return {
        type: acceptsType ? type : ("log" as const),
        text: String(entry["text"]),
        timestamp: typeof entry["timestamp"] === "number" ? entry["timestamp"] : Date.now(),
      };
    });
    return {
      tool,
      url,
      title,
      screenshot,
      screenshotMimeType: "image/png",
      consoleLogs: logs,
    };
  }

  private buildView(): BrowserPanelViewSnapshot {
    return buildBrowserPanelView({
      runId: this.stream.runId,
      sessionId: this.sessionIdValue,
      phase: this.phase,
      lastRequestedUrl: this.lastRequestedUrl,
      pendingPermissionRequestId: this.pendingPermissionRequestId,
      pendingPrompt: this.pendingPrompt,
      evidence: this.evidenceRow,
      errorMessage: this.errorMessage,
    });
  }

  private refreshView(): void {
    this.view = this.buildView();
  }
}
