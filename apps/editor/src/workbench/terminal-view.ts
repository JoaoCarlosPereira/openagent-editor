import type { IntegratedTerminalSession } from "./terminal.js";

export interface TerminalViewInput {
  session: IntegratedTerminalSession | null;
}

export interface TerminalViewSnapshot {
  html: string;
  accessible: {
    open: boolean;
    relativeCwd: string | null;
    lastCommand: string | null;
    lastExitCode: number | null;
    outputLength: number;
    status: IntegratedTerminalSession["status"] | null;
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

/** LOC-01 (122): painel observável do terminal integrado. */
export function buildTerminalView(input: TerminalViewInput): TerminalViewSnapshot {
  const session = input.session;
  const open = session !== null;
  const focusOrder = open
    ? ([
        "workbench-slot-terminal",
        "terminal-cwd",
        "terminal-output",
        "terminal-input",
        "terminal-run",
      ] as const)
    : (["workbench-slot-terminal"] as const);

  const body = open
    ? [
        `<p data-testid="terminal-cwd" tabindex="0"`,
        ` data-relative-cwd="${escapeHtml(session.relativeCwd)}">`,
        `${escapeHtml(session.relativeCwd === "" ? "." : session.relativeCwd)}</p>`,
        `<pre data-testid="terminal-output" aria-label="Saída do terminal" tabindex="0"`,
        ` data-status="${escapeHtml(session.status)}"`,
        ` data-last-exit-code="${session.lastExitCode === null ? "" : String(session.lastExitCode)}">`,
        `${escapeHtml(session.output)}</pre>`,
        `<input data-testid="terminal-input" type="text" aria-label="Comando do terminal"`,
        ` tabindex="0" />`,
        `<button type="button" data-testid="terminal-run" tabindex="0">Executar</button>`,
        session.lastCommand !== null
          ? `<span data-testid="terminal-last-command" aria-live="polite">${escapeHtml(session.lastCommand)}</span>`
          : `<span data-testid="terminal-last-command" aria-live="polite"></span>`,
      ].join("")
    : `<p data-testid="terminal-empty" aria-live="polite">Abra o terminal na pasta do workspace</p>`;

  const html = [
    `<section role="region" aria-label="terminal"`,
    ` data-testid="workbench-slot-terminal" data-capability="terminal"`,
    ` data-terminal-panel="workbench-integrated-terminal"`,
    ` data-terminal-open="${open ? "true" : "false"}"`,
    ` data-cwd="${open ? escapeHtml(session.relativeCwd) : ""}" tabindex="0">`,
    `<h3 data-testid="terminal-heading">terminal</h3>`,
    body,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      open,
      relativeCwd: open ? session.relativeCwd : null,
      lastCommand: open ? session.lastCommand : null,
      lastExitCode: open ? session.lastExitCode : null,
      outputLength: open ? session.output.length : 0,
      status: open ? session.status : null,
      focusOrder,
    },
  };
}
