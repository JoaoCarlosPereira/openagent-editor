import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCanonicalWorkspacePath } from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export interface EditorDecoration {
  id: string;
  backgroundColor?: string;
  outlineColor?: string;
}

export interface EditorRange {
  start: number;
  end: number;
}

interface DocumentState {
  uri: string;
  relativePath: string;
  text: string;
  diskText: string;
  version: number;
}

function invalid(message: string): never {
  throw new ProtocolError("INVALID_STATE", message);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Buffer de editor baseado na abertura confinada de task_121 (feat/task-121,
 * commit 16c2ec4). A interface de requisições é usada pelo extension host.
 */
export class ExtensionEditorController {
  private document: DocumentState | null = null;
  private decorations = new Map<string, { decoration: EditorDecoration; ranges: EditorRange[] }>();

  constructor(private readonly root: string) {}

  get snapshot(): { html: string; text: string; version: number; dirty: boolean } | null {
    const document = this.document;
    if (!document) return null;
    const spans = [...this.decorations.values()].flatMap(({ decoration, ranges }) =>
      ranges.map((range) => ({ decoration, ...range })));
    const boundaries = [...new Set([0, document.text.length, ...spans.flatMap((range) => [range.start, range.end])])]
      .sort((a, b) => a - b);
    const html = boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1] ?? start;
      const text = escapeHtml(document.text.slice(start, end));
      const active = spans.filter((range) => range.start <= start && range.end >= end);
      if (!active.length) return text;
      const decoration = active[active.length - 1]?.decoration;
      const styles = [
        decoration?.backgroundColor ? `background-color:${decoration.backgroundColor}` : "",
        decoration?.outlineColor ? `outline:1px solid ${decoration.outlineColor}` : "",
      ].filter(Boolean).join(";");
      return `<span data-decoration="${escapeHtml(decoration?.id ?? "")}" style="${escapeHtml(styles)}">${text}</span>`;
    }).join("");
    return {
      html: `<pre data-testid="text-editor-decorations">${html}</pre>`,
      text: document.text,
      version: document.version,
      dirty: document.text !== document.diskText,
    };
  }

  handleRequest(request: { operation: string; args: unknown[] }): unknown {
    const [uri, second, third] = request.args;
    if (typeof uri !== "string") return invalid("URI inválida.");
    if (request.operation === "openTextDocument") {
      let file: string;
      try {
        file = fileURLToPath(uri);
      } catch {
        return invalid("URI de arquivo inválida.");
      }
      const resolved = resolveCanonicalWorkspacePath(this.root, file);
      if (!resolved.ok) throw resolved.error;
      if (!statSync(resolved.canonicalPath).isFile()) return invalid("Documento não é arquivo.");
      const text = readFileSync(resolved.canonicalPath, "utf8");
      this.document = { uri, relativePath: path.relative(this.root, resolved.canonicalPath), text, diskText: text, version: 1 };
      this.decorations.clear();
      return { uri, version: 1, lineCount: text.split("\n").length, text };
    }
    const document = this.document;
    if (!document || document.uri !== uri) return invalid("Documento não está aberto.");
    if (request.operation === "applyTextEdits") {
      if (second !== document.version) throw new ProtocolError("CONFLICT", "Versão do documento divergente.");
      if (!Array.isArray(third)) return invalid("Edições inválidas.");
      const edits = third as { start: number; end: number; text: string }[];
      if (edits.some((edit) => !edit || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) ||
        edit.start < 0 || edit.end < edit.start || edit.end > document.text.length || typeof edit.text !== "string")) {
        return invalid("Intervalo de edição inválido.");
      }
      const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
      if (ordered.some((edit, index) => {
        const previous = ordered[index - 1];
        return previous && (edit.start < previous.end || edit.start === previous.start);
      })) {
        return invalid("Edições sobrepostas.");
      }
      if (!ordered.length) return true;
      let text = document.text;
      for (const edit of ordered.reverse()) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      document.text = text;
      document.version++;
      this.decorations.clear();
      return true;
    }
    if (request.operation === "setDecorations") {
      const decoration = second as EditorDecoration;
      if (!decoration || typeof decoration.id !== "string" || !decoration.id || !Array.isArray(third)) return invalid("Decoração inválida.");
      for (const color of [decoration.backgroundColor, decoration.outlineColor]) {
        if (color !== undefined && (typeof color !== "string" || !/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(color))) {
          return invalid("Cor de decoração inválida.");
        }
      }
      const ranges = third as EditorRange[];
      if (ranges.some((range) => !range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
        range.start < 0 || range.end < range.start || range.end > document.text.length)) return invalid("Intervalo de decoração inválido.");
      this.decorations.set(decoration.id, { decoration: { ...decoration }, ranges: ranges.map((range) => ({ ...range })) });
      return true;
    }
    return invalid("Operação de editor desconhecida.");
  }
}
