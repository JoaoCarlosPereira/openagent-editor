import { closeSync, fchmodSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export { OUT_OF_SCOPE_PATH_LOG_MESSAGE };

export const TEXT_EDITOR_FOLDER_REQUIRED_MESSAGE =
  "Pasta raiz obrigatória para abrir arquivo no editor.";
export const TEXT_EDITOR_PATH_REQUIRED_MESSAGE =
  "Caminho de arquivo inválido para o editor de texto.";
export const TEXT_EDITOR_NOT_A_FILE_MESSAGE =
  "O caminho não aponta para um arquivo editável.";
export const TEXT_EDITOR_NO_DOCUMENT_MESSAGE =
  "Nenhum documento aberto no editor de texto.";
export const TEXT_EDITOR_CONTENT_REQUIRED_MESSAGE =
  "Conteúdo inválido para editar o documento aberto.";

export interface TextEditorDocument {
  /** Caminho relativo ao root da pasta aberta (separador `/`). */
  relativePath: string;
  /** Conteúdo atual no buffer do editor. */
  content: string;
  /** Último conteúdo persistido em disco (baseline para dirty). */
  diskContent: string;
  /** true quando o buffer difere do disco. */
  dirty: boolean;
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function assertNonEmptyRoot(rootFolder: unknown): string {
  if (typeof rootFolder !== "string" || rootFolder.trim() === "") {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_FOLDER_REQUIRED_MESSAGE, [
      `rootFolder=${String(rootFolder)}`,
    ]);
  }
  return path.resolve(rootFolder.trim());
}

function assertRelativeFilePath(relativePath: unknown): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_PATH_REQUIRED_MESSAGE, [
      `relativePath=${String(relativePath)}`,
    ]);
  }
  const trimmed = relativePath.trim();
  if (path.isAbsolute(trimmed)) {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_PATH_REQUIRED_MESSAGE, [
      `relativePath=${trimmed}`,
    ]);
  }
  return toPosixRelative(trimmed);
}

function resolveFileUnderRoot(
  rootFolder: string,
  relativePath: string,
): { canonicalPath: string; relativePath: string } {
  const requested = path.join(rootFolder, relativePath);
  const resolved = resolveCanonicalWorkspacePath(rootFolder, requested);
  if (!resolved.ok) {
    throw resolved.error;
  }
  let stats;
  try {
    stats = statSync(resolved.canonicalPath);
  } catch {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_NOT_A_FILE_MESSAGE, [
      `relativePath=${relativePath}`,
    ]);
  }
  if (!stats.isFile()) {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_NOT_A_FILE_MESSAGE, [
      `relativePath=${relativePath}`,
    ]);
  }
  return {
    canonicalPath: resolved.canonicalPath,
    relativePath: toPosixRelative(path.relative(rootFolder, resolved.canonicalPath)),
  };
}

/**
 * Lê um arquivo de texto sob a pasta aberta (LOC-01 / task_121).
 * Fora do root → OUT_OF_SCOPE; path inválido / não-arquivo → INVALID_STATE.
 */
export function openTextEditorDocument(
  rootFolder: unknown,
  relativePath: unknown,
): TextEditorDocument {
  const root = assertNonEmptyRoot(rootFolder);
  const relative = assertRelativeFilePath(relativePath);
  const file = resolveFileUnderRoot(root, relative);
  const content = readFileSync(file.canonicalPath, "utf8");
  return {
    relativePath: file.relativePath,
    content,
    diskContent: content,
    dirty: false,
  };
}

/**
 * Aplica edição em memória ao documento aberto (não grava disco).
 */
export function applyTextEditorEdit(
  document: TextEditorDocument | null,
  content: unknown,
): TextEditorDocument {
  if (document === null) {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_NO_DOCUMENT_MESSAGE, []);
  }
  if (typeof content !== "string") {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_CONTENT_REQUIRED_MESSAGE, [
      `content=${String(content)}`,
    ]);
  }
  return {
    relativePath: document.relativePath,
    content,
    diskContent: document.diskContent,
    dirty: content !== document.diskContent,
  };
}

/**
 * Persiste o documento aberto no disco sob o root da pasta (LOC-01 / task_121).
 */
export function saveTextEditorDocument(
  rootFolder: unknown,
  document: TextEditorDocument | null,
): TextEditorDocument {
  if (document === null) {
    throw new ProtocolError("INVALID_STATE", TEXT_EDITOR_NO_DOCUMENT_MESSAGE, []);
  }
  const root = assertNonEmptyRoot(rootFolder);
  const file = resolveFileUnderRoot(root, document.relativePath);
  const conflict = () => new ProtocolError("CONFLICT", "O arquivo foi alterado fora do editor.", []);
  const before = statSync(file.canonicalPath, { bigint: true });
  if (readFileSync(file.canonicalPath, "utf8") !== document.diskContent) throw conflict();
  const tempDir = mkdtempSync(path.join(path.dirname(file.canonicalPath), ".openagent-save-"));
  const temp = path.join(tempDir, "document");
  try {
    const fd = openSync(temp, "wx", Number(before.mode & 0o777n));
    try {
      fchmodSync(fd, Number(before.mode & 0o777n));
      writeFileSync(fd, document.content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const resolved = resolveFileUnderRoot(root, document.relativePath);
    const after = statSync(resolved.canonicalPath, { bigint: true });
    if (resolved.canonicalPath !== file.canonicalPath || before.dev !== after.dev ||
        before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        readFileSync(resolved.canonicalPath, "utf8") !== document.diskContent) throw conflict();
    renameSync(temp, file.canonicalPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return {
    relativePath: file.relativePath,
    content: document.content,
    diskContent: document.content,
    dirty: false,
  };
}
