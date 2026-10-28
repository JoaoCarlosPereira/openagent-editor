import { formatGrantScopeLabel, type GrantScopeKind } from "@openagent/policy";

export interface PermissionDialogViewInput {
  requestId: string;
  action: string;
  target: string;
  offeredScopes: readonly GrantScopeKind[];
  selectedScope: GrantScopeKind;
  degradationNotice?: string;
  sandboxIsolationLevel?: "native" | "degraded";
}

export interface PermissionDialogViewSnapshot {
  html: string;
  accessible: {
    action: string;
    target: string;
    scopeLabels: string[];
    selectedScopeLabel: string;
    degradationNotice?: string;
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** PER-01: markup estável para e2e e acessibilidade (role=dialog). */
export function buildPermissionDialogView(input: PermissionDialogViewInput): PermissionDialogViewSnapshot {
  const scopeLabels = input.offeredScopes.map((scope) => formatGrantScopeLabel(scope));
  const selectedScopeLabel = formatGrantScopeLabel(input.selectedScope);
  const degradation = input.degradationNotice?.trim();

  const scopeOptions = input.offeredScopes
    .map((scope) => {
      const label = formatGrantScopeLabel(scope);
      const selected = scope === input.selectedScope ? ' aria-selected="true"' : "";
      return `<li data-testid="permission-scope-option" data-scope="${scope}"${selected}>${escapeHtml(label)}</li>`;
    })
    .join("");

  const degradationBlock = degradation
    ? `<p data-testid="permission-degradation" role="note">${escapeHtml(degradation)}</p>`
    : "";

  const html = [
    `<section role="dialog" aria-labelledby="permission-dialog-title" data-testid="permission-dialog">`,
    `<h2 id="permission-dialog-title" data-testid="permission-action">${escapeHtml(input.action)}</h2>`,
    `<p data-testid="permission-target">${escapeHtml(input.target)}</p>`,
    `<p data-testid="permission-scope-label">${escapeHtml(selectedScopeLabel)}</p>`,
    `<ul data-testid="permission-scope-list">${scopeOptions}</ul>`,
    degradationBlock,
    `<button type="button" data-testid="permission-accept">Aceitar</button>`,
    `<button type="button" data-testid="permission-deny">Recusar</button>`,
    `</section>`,
  ].join("");

  return {
    html,
    accessible: {
      action: input.action,
      target: input.target,
      scopeLabels,
      selectedScopeLabel,
      ...(degradation ? { degradationNotice: degradation } : {}),
    },
  };
}
