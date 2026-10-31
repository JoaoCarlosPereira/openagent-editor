export type IsolatedWorkPhase = "idle" | "creating" | "active" | "applying" | "discarding" | "applied" | "discarded" | "conflict";

export interface IsolatedWorkViewInput {
  phase: IsolatedWorkPhase;
  isolatedWorkId: string | null;
  isolatedWorkspaceRoot: string | null;
  gitBranch: string | null;
  errorCode: string | null;
  changedPaths: readonly string[];
}

export interface IsolatedWorkViewSnapshot {
  html: string;
  accessible: IsolatedWorkViewInput;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function buildIsolatedWorkView(input: IsolatedWorkViewInput): IsolatedWorkViewSnapshot {
  const actions = input.phase === "active"
    ? '<button type="button" data-testid="isolated-work-apply">Aplicar alterações</button><button type="button" data-testid="isolated-work-discard">Descartar</button>'
    : "";
  const root = input.isolatedWorkspaceRoot ? `<p data-testid="isolated-work-root">${escapeHtml(input.isolatedWorkspaceRoot)}</p>` : "";
  const paths = input.changedPaths.map((path) => `<li data-testid="isolated-work-changed-path">${escapeHtml(path)}</li>`).join("");
  const error = input.errorCode ? `<p role="alert" data-testid="isolated-work-error" data-code="${escapeHtml(input.errorCode)}">${escapeHtml(input.errorCode)}</p>` : "";
  return {
    html: `<section data-testid="isolated-work-panel" data-phase="${input.phase}"><h2>Trabalho isolado</h2><label for="isolated-work-id">Identificador</label><input id="isolated-work-id" data-testid="isolated-work-id" value="${escapeHtml(input.isolatedWorkId ?? "")}" ${input.phase === "idle" ? "" : "disabled"}/>${input.phase === "idle" ? '<button type="button" data-testid="isolated-work-create">Criar worktree</button>' : ""}${root}<p data-testid="isolated-work-status" role="status">Estado: ${input.phase}</p><ul>${paths}</ul>${actions}${error}</section>`,
    accessible: { ...input, changedPaths: [...input.changedPaths] },
  };
}
