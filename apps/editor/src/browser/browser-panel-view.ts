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

  const html = [
    `<section data-testid="browser-panel" aria-label="Painel do navegador"`,
    ` data-run-id="${escapeHtml(input.runId)}"`,
    ` data-session-id="${escapeHtml(input.sessionId)}"`,
    ` data-phase="${escapeHtml(input.phase)}">`,
    `<h2 data-testid="browser-panel-title">Navegador</h2>`,
    `<p data-testid="browser-status" aria-live="polite">${escapeHtml(phaseLabel)}</p>`,
    openForm,
    permissionBlock,
    failureBlock,
    evidenceBlock,
    hint,
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
    },
  };
}
