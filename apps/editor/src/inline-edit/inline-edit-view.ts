/** INL-01: view do Inline Edit com diff, aceitar, rejeitar e refinar. */

export type InlineEditPhase =
  | "idle"
  | "generating"
  | "refining"
  | "reviewing"
  | "accepted"
  | "rejected";

export type InlineEditMode = "selection" | "insert";

export type InlineEditDiffRowKind = "context" | "add" | "remove";

export interface InlineEditDiffRow {
  kind: InlineEditDiffRowKind;
  text: string;
}

export interface InlineEditViewInput {
  phase: InlineEditPhase;
  mode: InlineEditMode | null;
  proposal: string | null;
  originalText: string | null;
}

export interface InlineEditViewSnapshot {
  html: string;
  accessible: {
    phase: InlineEditPhase;
    statusLabel: string;
    mode: InlineEditMode | null;
    proposal: string | null;
    originalText: string | null;
    /** true quando o diff da proposta esta visivel sobre o original. */
    showsDiff: boolean;
    canAccept: boolean;
    canReject: boolean;
    canRefine: boolean;
    /** true quando o alvo e uma insercao no cursor (start == end). */
    insertAtCursor: boolean;
    /** true quando o texto original permanecido intacto e visivel para revisao. */
    preservesOriginal: boolean;
  };
}

export function inlineEditStatusLabel(phase: InlineEditPhase): string {
  switch (phase) {
    case "idle":
      return "Sem edicao inline";
    case "generating":
      return "Gerando edicao";
    case "refining":
      return "Refinando edicao";
    case "reviewing":
      return "Edicao em revisao";
    case "accepted":
      return "Edicao aplicada";
    case "rejected":
      return "Edicao rejeitada";
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Diff por linhas (LCS) entre o original preservado e a proposta. */
export function computeInlineEditDiff(originalText: string, proposedText: string): InlineEditDiffRow[] {
  const a = originalText.split("\n");
  const b = proposedText.split("\n");
  const atA = (k: number): string => a[k] ?? "";
  const atB = (k: number): string => b[k] ?? "";
  const widths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    const row = widths[i];
    if (!row) {
      break;
    }
    const nextRow = widths[i + 1];
    if (!nextRow) {
      break;
    }
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        atA(i) === atB(j)
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const widthAt = (i: number, j: number): number => widths[i]?.[j] ?? 0;
  const rows: InlineEditDiffRow[] = [];
  let i = 0;
  let j = 0;
  const push = (kind: InlineEditDiffRowKind, text: string): void => {
    rows.push({ kind, text });
  };
  while (i < a.length && j < b.length) {
    if (atA(i) === atB(j)) {
      push("context", atA(i));
      i++;
      j++;
      continue;
    }
    if (widthAt(i + 1, j) >= widthAt(i, j + 1)) {
      if (atA(i) !== "") {
        push("remove", atA(i));
      }
      i++;
      continue;
    }
    if (atB(j) !== "") {
      push("add", atB(j));
    }
    j++;
  }
  while (i < a.length) {
    if (atA(i) !== "") {
      push("remove", atA(i));
    }
    i++;
  }
  while (j < b.length) {
    if (atB(j) !== "") {
      push("add", atB(j));
    }
    j++;
  }
  return rows;
}

function renderDiffRow(row: InlineEditDiffRow): string {
  return `<span data-testid="inline-edit-diff-row" data-kind="${row.kind}">${escapeHtml(row.text)}</span>`;
}

export function buildInlineEditView(input: InlineEditViewInput): InlineEditViewSnapshot {
  const inReview = input.phase === "reviewing";
  const canAccept = inReview;
  const canReject = inReview;
  const canRefine = inReview;
  const showsDiff = inReview
    || input.phase === "refining"
    || ((input.phase === "accepted" || input.phase === "rejected") && input.proposal !== null);
  const showActions = input.phase === "generating" || input.phase === "refining" || inReview;
  const statusLabel = inlineEditStatusLabel(input.phase);
  const keepsSelection = input.mode === "selection" && input.originalText !== null;
  const insertAtCursor = input.mode === "insert";
  const showsSelection = keepsSelection || insertAtCursor;
  const diffRows = showsDiff && input.originalText !== null && input.proposal !== null
    ? computeInlineEditDiff(input.originalText, input.proposal)
    : [];

  const parts: string[] = [
    `<section data-testid="inline-edit-panel"`,
    input.mode !== null ? ` data-mode="${input.mode}"` : ``,
    ` data-phase="${input.phase}">`,
    `<p data-testid="inline-edit-status" role="status">${statusLabel}</p>`,
  ];
  if (showsSelection) {
    parts.push(
      insertAtCursor
        ? `<p data-testid="inline-edit-insert-cursor">${escapeHtml("Insercao no cursor")}</p>`
        : `<p data-testid="inline-edit-selection">${escapeHtml("Selecao original")}</p>`,
    );
  }
  if (showsDiff) {
    parts.push(`<div data-testid="inline-edit-diff">${diffRows.map(renderDiffRow).join("")}</div>`);
  }
  if (showActions) {
    parts.push(
      `<input type="text" data-testid="inline-edit-refine-instruction" aria-label="Instrucao de refinamento">`,
      `<button type="button" data-testid="inline-edit-refine"${inReview ? "" : " disabled"}>Refinar</button>`,
      `<button type="button" data-testid="inline-edit-accept"${canAccept ? "" : " disabled"}>Aceitar</button>`,
      `<button type="button" data-testid="inline-edit-reject"${canReject ? "" : " disabled"}>Rejeitar</button>`,
    );
  } else {
    parts.push(
      `<button type="button" data-testid="inline-edit-accept" disabled>Aceitar</button>`,
      `<button type="button" data-testid="inline-edit-reject" disabled>Rejeitar</button>`,
    );
  }
  parts.push(`</section>`);

  return {
    html: parts.join(""),
    accessible: {
      phase: input.phase,
      statusLabel,
      mode: input.mode,
      proposal: input.proposal,
      originalText: input.originalText,
      showsDiff,
      canAccept,
      canReject,
      canRefine,
      insertAtCursor,
      preservesOriginal: keepsSelection,
    },
  };
}
