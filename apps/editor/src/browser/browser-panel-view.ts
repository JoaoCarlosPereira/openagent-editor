/**
 * AUT-01: view observável do painel do navegador no editor —
 * captura (screenshot PNG) e texto de console exibidos após autorização.
 */

import type { BrowserConsoleLogEntry } from "@openagent/tools";

export type BrowserPanelUiPhase =
  | "idle"
  | "pending"
  | "denied"
  | "loading"
  | "evidence"
  | "failed";

export type BrowserPanelLastInteraction = "browser.open" | "browser.click" | null;

export interface BrowserPanelEvidenceRow {
  tool: "browser.open" | "browser.click";
  url: string;
  title: string;
  screenshot: string;
  screenshotMimeType: "image/png";
  consoleLogs: readonly BrowserConsoleLogEntry[];
}

/** DES-01: seleção de elemento pendente de anexo na mensagem seguinte. */
export interface BrowserPanelDrawSelectionRow {
  id: string;
  selector: string;
  codeSnippet: string;
  url: string;
}

export interface BrowserPanelViewInput {
  runId: string;
  sessionId: string;
  phase: BrowserPanelUiPhase;
  /** Última URL pedida (mantida no campo de entrada). */
  lastRequestedUrl: string;
  pendingPermissionRequestId: string | null;
  pendingPrompt: { action: string; target: string; scopeLabel: string } | null;
  evidence: BrowserPanelEvidenceRow | null;
  errorMessage: string | null;
  /** DES-01: modo desenho (seleção de elemento na captura autorizada). */
  drawMode: boolean;
  /** DES-01: seleção pendente de anexo à mensagem seguinte. */
  pendingSelection: BrowserPanelDrawSelectionRow | null;
}

export interface BrowserPanelViewSnapshot {
  html: string;
  accessible: {
    runId: string;
    sessionId: string;
    phase: BrowserPanelUiPhase;
    phaseLabel: string;
    lastRequestedUrl: string;
    pendingPermissionRequestId: string | null;
    screenshotPresent: boolean;
    screenshotUrl: string | null;
    lastUrl: string | null;
    lastInteraction: BrowserPanelLastInteraction;
    consoleEntryCount: number;
    consoleLogTypes: readonly string[];
    canOpen: boolean;
    canClick: boolean;
    errorMessage: string | null;
    /** DES-01: modo desenho ativado sobre o target autorizado. */
    drawMode: boolean;
    /** DES-01: seleção pendente para a próxima mensagem do agente. */
    pendingSelection: {
      id: string;
      selector: string;
      codeSnippetPresent: boolean;
      url: string;
    } | null;
    /** DES-01: modo desenho pode ser ativado (navegador autorizado com captura). */
    canEnterDrawMode: boolean;
    /** DES-01: seleção de elemento permitida no estado corrente. */
    canSelectElement: boolean;
  };
}

export function browserPanelStatusLabel(phase: BrowserPanelUiPhase): string {
  switch (phase) {
    case "idle":
      return "Sem navegador aberto";
    case "pending":
      return "Aguardando autorização";
    case "denied":
      return "Autorização recusada";
    case "loading":
      return "Carregando captura e console";
    case "evidence":
      return "Captura e console exibidos";
    case "failed":
      return "Falha na execução do navegador";
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Codificação de evidência determinística: sem markup volátil (usada em comparação de snapshots). */
export function browserConsoleEntryLabel(entry: BrowserConsoleLogEntry): string {
  return `${entry.type}: ${entry.text}`;
}

function renderPermissionPrompt(
  permissionRequestId: string,
  prompt: { action: string; target: string; scopeLabel: string },
): string {
  return [
    `<form data-testid="browser-permission-prompt" data-permission-request-id="${escapeHtml(permissionRequestId)}"`,
    ` aria-label="Autorização do navegador">`,
    `<span data-testid="browser-permission-action">Ação: ${escapeHtml(prompt.action)}</span>`,
    `<span data-testid="browser-permission-target">Alvo: ${escapeHtml(prompt.target)}</span>`,
    `<span data-testid="browser-permission-scope">Escopo: ${escapeHtml(prompt.scopeLabel)}</span>`,
    `<button type="button" data-testid="browser-allow-button"`,
    ` aria-label="Permitir ação do navegador">Permitir</button>`,
    `<button type="button" data-testid="browser-deny-button"`,
    ` aria-label="Recusar ação do navegador">Recusar</button>`,
    `</form>`,
  ].join("");
}

function renderEvidence(evidence: BrowserPanelEvidenceRow): string {
  const consoleEntries =
    evidence.consoleLogs.length === 0
      ? `<p data-testid="browser-console-empty">Sem mensagens de console</p>`
      : [
          `<ol data-testid="browser-console" aria-label="Console do navegador"`,
          ` aria-live="polite">`,
          ...evidence.consoleLogs.map((entry) =>
            [
              `<li data-testid="browser-console-entry"`,
              ` data-log-type="${escapeHtml(entry.type)}">`,
              escapeHtml(browserConsoleEntryLabel(entry)),
              `</li>`,
            ].join(""),
          ),
          `</ol>`,
        ].join("");
  return [
    `<div data-testid="browser-evidence"`,
    ` data-dataset="${escapeHtml(evidence.tool)}">`,
    `<h3 data-testid="browser-capture-title">Captura</h3>`,
    `<p data-testid="browser-open-url"`,
    ` data-url="${escapeHtml(evidence.url)}">URL: ${escapeHtml(evidence.url)}</p>`,
    `<img data-testid="browser-screenshot" data-dataset="${escapeHtml(evidence.tool)}"`,
    ` src="data:${escapeHtml(evidence.screenshotMimeType)};base64,${escapeHtml(evidence.screenshot)}"`,
    ` alt="Captura do navegador em ${escapeHtml(evidence.url)}"`,
    ` aria-label="Captura do navegador">`,
    `<h3 data-testid="browser-console-title">Texto de console</h3>`,
    consoleEntries,
    `</div>`,
  ].join("");
}

/** DES-01: captura autorizada permite entrar/desativar o modo desenho. */
export function browserDrawModeButtonLabel(drawMode: boolean): string {
  return drawMode ? "Sair do modo desenho" : "Ativar modo desenho";
}

function renderDrawModeControls(
  phase: BrowserPanelUiPhase,
  drawMode: boolean,
): string {
  const controls: string[] = [];
  if (phase === "evidence") {
    controls.push(
      `<button type="button" data-testid="browser-draw-mode-button"`,
      ` aria-label="${escapeHtml(browserDrawModeButtonLabel(drawMode))}"`,
      `>${escapeHtml(browserDrawModeButtonLabel(drawMode))}</button>`,
    );
  }
  if (drawMode && phase === "evidence") {
    controls.push(
      `<p data-testid="browser-draw-mode-active"`,
      ` aria-label="Modo desenho ativo">Modo desenho ativo: selecione um`,
      ` elemento na captura para anexar identidade e código</p>`,
    );
  }
  return controls.join("");
}

function renderPendingSelection(
  selection: BrowserPanelDrawSelectionRow,
): string {
  return [
    `<div data-testid="browser-draw-selection"`,
    ` data-selection-id="${escapeHtml(selection.id)}"`,
    ` data-selector="${escapeHtml(selection.selector)}">`,
    `<p data-testid="browser-draw-selection-identity">Elemento:`,
    ` ${escapeHtml(selection.selector)} em ${escapeHtml(selection.url)}</p>`,
    `<pre data-testid="browser-draw-code-snippet"><code>${escapeHtml(selection.codeSnippet)}</code></pre>`,
    `<p data-testid="browser-draw-attachment-note">Anexo da próxima mensagem</p>`,
    `</div>`,
  ].join("");
}

/** AUT-01: autorização → URL aberta e interação autorizada → captura e texto de console visíveis. */
export function buildBrowserPanelView(
  input: BrowserPanelViewInput,
): BrowserPanelViewSnapshot {
  const phaseLabel = browserPanelStatusLabel(input.phase);
  const canOpen = input.phase !== "pending" && input.phase !== "loading";
  const canClick = input.phase === "evidence";

  const openForm = [
    `<form data-testid="browser-open-form" aria-label="Abrir URL autorizada">`,
    `<label for="browser-url-input">URL para abrir no navegador autorizado</label>`,
    `<input id="browser-url-input" data-testid="browser-url-input"`,
    ` name="url" type="text" value="${escapeHtml(input.lastRequestedUrl)}"`,
    ` placeholder="URL autorizada" ${canOpen ? "" : "disabled"}>`,
    `<button type="button" data-testid="browser-open-button"`,
    ` aria-label="Abrir URL no navegador" ${canOpen ? "" : "disabled"}>Abrir</button>`,
    `</form>`,
  ].join("");

  const permissionBlock =
    input.phase === "pending" && input.pendingPermissionRequestId
      ? renderPermissionPrompt(input.pendingPermissionRequestId, input.pendingPrompt ?? {
          action: "",
          target: "",
          scopeLabel: "",
        })
      : input.phase === "denied"
        ? `<p data-testid="browser-denied">Autorização recusada: nenhuma URL foi aberta.</p>`
        : "";

  const evidenceBlock =
    input.evidence === null
      ? `<p data-testid="browser-capture-empty">Nenhuma captura do navegador ainda</p>`
      : renderEvidence(input.evidence);

  const failureBlock =
    input.phase === "failed" && input.errorMessage !== null
      ? [
          `<p data-testid="browser-failed" aria-live="assertive">`,
          `Falha: ${escapeHtml(input.errorMessage)}`,
          `</p>`,
        ].join("")
      : "";

  const hint = canClick
    ? `<p data-testid="browser-open-hint">Informe seletor para interagir no target autorizado</p>`
    : "";

  const drawControls = renderDrawModeControls(input.phase, input.drawMode);
  const drawSelectionBlock =
    input.pendingSelection === null
      ? ""
      : renderPendingSelection(input.pendingSelection);

  const html = [
    `<section data-testid="browser-panel" aria-label="Painel do navegador"`,
    ` data-run-id="${escapeHtml(input.runId)}"`,
    ` data-session-id="${escapeHtml(input.sessionId)}"`,
    ` data-phase="${escapeHtml(input.phase)}"`,
    ` data-draw-mode="${input.drawMode ? "on" : "off"}">`,
    `<h2 data-testid="browser-panel-title">Navegador</h2>`,
    `<p data-testid="browser-status" aria-live="polite">${escapeHtml(phaseLabel)}</p>`,
    openForm,
    permissionBlock,
    failureBlock,
    evidenceBlock,
    hint,
    drawControls,
    drawSelectionBlock,
    `</section>`,
  ].join("");

  const evidence = input.evidence;
  const consoleTypes = (evidence?.consoleLogs ?? []).map((e) => e.type);

  return {
    html,
    accessible: {
      runId: input.runId,
      sessionId: input.sessionId,
      phase: input.phase,
      phaseLabel,
      lastRequestedUrl: input.lastRequestedUrl,
      pendingPermissionRequestId: input.pendingPermissionRequestId,
      screenshotPresent: evidence !== null,
      screenshotUrl: evidence !== null ? evidence.url : null,
      lastUrl: evidence !== null ? evidence.url : null,
      lastInteraction: evidence?.tool ?? null,
      consoleEntryCount: (evidence?.consoleLogs ?? []).length,
      consoleLogTypes: consoleTypes,
      canOpen,
      canClick,
      errorMessage: input.errorMessage,
      drawMode: input.drawMode,
      pendingSelection:
        input.pendingSelection === null
          ? null
          : {
              id: input.pendingSelection.id,
              selector: input.pendingSelection.selector,
              codeSnippetPresent: input.pendingSelection.codeSnippet.trim().length > 0,
              url: input.pendingSelection.url,
            },
      canEnterDrawMode: input.phase === "evidence",
      canSelectElement: input.drawMode && input.phase === "evidence",
    },
  };
}
