import type { DebugBreakpoint, DebugStatus, IntegratedDebugSession } from "./debug-session.js";

export interface DebugViewInput {
  session: IntegratedDebugSession | null;
}

export interface DebugViewSnapshot {
  html: string;
  accessible: {
    open: boolean;
    dapVersion: string | null;
    targetRelativePath: string | null;
    status: DebugStatus | null;
    stopReason: string | null;
    currentLine: number | null;
    breakpointCount: number;
    breakpoints: readonly { id: string; relativePath: string; line: number; verified: boolean }[];
    focusOrder: readonly string[];
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBreakpointItem(bp: DebugBreakpoint): string {
  return [
    `<li data-testid="debug-breakpoint-${bp.id}"`,
    ` data-path="${escapeHtml(bp.relativePath)}"`,
    ` data-line="${bp.line}"`,
    ` data-verified="${bp.verified ? "true" : "false"}" tabindex="0">`,
    `${escapeHtml(bp.relativePath)}:${bp.line}`,
    `</li>`,
  ].join("");
}

/** LOC-01 (124): painel observável de depuração DAP integrado. */
export function buildDebugView(input: DebugViewInput): DebugViewSnapshot {
  const session = input.session;
  const open = session !== null;

  const focusOrder = open
    ? ([
        "workbench-slot-debug",
        "debug-target",
        "debug-status",
        "debug-breakpoints-list",
        "debug-start",
        "debug-stop",
        "debug-continue",
        "debug-step-over",
      ] as const)
    : (["workbench-slot-debug"] as const);

  const body = open
    ? [
        `<p data-testid="debug-target" aria-label="Alvo DAP" tabindex="0"`,
        ` data-target="${escapeHtml(session.targetRelativePath)}">`,
        `${escapeHtml(session.targetRelativePath)}</p>`,
        `<span data-testid="debug-status" aria-label="Status da sessão" tabindex="0"`,
        ` data-status="${escapeHtml(session.status)}"`,
        ` data-dap-version="${escapeHtml(session.dapVersion)}">`,
        `${escapeHtml(session.status)}</span>`,
        session.stopReason !== null
          ? `<span data-testid="debug-stop-reason" aria-live="polite">${escapeHtml(session.stopReason)}</span>`
          : `<span data-testid="debug-stop-reason" aria-live="polite"></span>`,
        session.currentLine !== null
          ? `<span data-testid="debug-current-line" aria-live="polite">${session.currentLine}</span>`
          : `<span data-testid="debug-current-line" aria-live="polite"></span>`,
        `<ul data-testid="debug-breakpoints-list" aria-label="Breakpoints" tabindex="0">`,
        ...session.breakpoints.map(renderBreakpointItem),
        `</ul>`,
        `<pre data-testid="debug-output" aria-label="Saída do depurador" tabindex="0">`,
        `${escapeHtml(session.output)}</pre>`,
        `<button type="button" data-testid="debug-start" tabindex="0">Iniciar</button>`,
        `<button type="button" data-testid="debug-stop" tabindex="0">Parar</button>`,
        `<button type="button" data-testid="debug-continue" tabindex="0">Continuar</button>`,
        `<button type="button" data-testid="debug-step-over" tabindex="0">Avançar</button>`,
      ].join("")
    : `<p data-testid="debug-empty" aria-live="polite">Abra uma sessão de depuração na pasta do workspace</p>`;

  const html = [
    `<section role="region" aria-label="debug"`,
    ` data-testid="workbench-slot-debug" data-capability="debug"`,
    ` data-debug-panel="workbench-integrated-debug"`,
    ` data-debug-open="${open ? "true" : "false"}"`,
    ` data-dap-version="${open ? escapeHtml(session.dapVersion) : ""}"`,
    ` data-status="${open ? escapeHtml(session.status) : ""}" tabindex="0">`,
    `<h3 data-testid="debug-heading">debug</h3>`,
    body,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      open,
      dapVersion: open ? session.dapVersion : null,
      targetRelativePath: open ? session.targetRelativePath : null,
      status: open ? session.status : null,
      stopReason: open ? session.stopReason : null,
      currentLine: open ? session.currentLine : null,
      breakpointCount: open ? session.breakpoints.length : 0,
      breakpoints: open ? session.breakpoints : [],
      focusOrder,
    },
  };
}
