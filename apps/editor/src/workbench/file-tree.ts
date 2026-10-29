import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  OUT_OF_SCOPE_PATH_LOG_MESSAGE,
  resolveCanonicalWorkspacePath,
} from "@openagent/policy";
import { ProtocolError } from "@openagent/protocol";

export { OUT_OF_SCOPE_PATH_LOG_MESSAGE };

export type FileTreeEntryKind = "file" | "directory";

export interface FileTreeEntry {
  name: string;
  /** Caminho relativo ao root da pasta aberta (separador `/`). */
  relativePath: string;
  kind: FileTreeEntryKind;
}

export const FILE_TREE_ROOT_REQUIRED_MESSAGE =
  "Pasta raiz obrigatória para montar a árvore de arquivos.";
export const FILE_TREE_DIRECTORY_REQUIRED_MESSAGE =
  "Caminho de diretório inválido para expandir na árvore.";

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function assertNonEmptyRoot(rootFolder: unknown): string {
  if (typeof rootFolder !== "string" || rootFolder.trim() === "") {
    throw new ProtocolError("INVALID_STATE", FILE_TREE_ROOT_REQUIRED_MESSAGE, [
      `rootFolder=${String(rootFolder)}`,
    ]);
  }
  return path.resolve(rootFolder.trim());
}

/**
 * Lista entradas imediatas de um diretório sob a pasta aberta (LOC-01 / task_120).
 * Caminhos fora do root → OUT_OF_SCOPE (ERR-02); root/dir inválidos → INVALID_STATE.
 */
export function listFileTreeDirectory(
  rootFolder: unknown,
  relativeDirectory: unknown = "",
): FileTreeEntry[] {
  const root = assertNonEmptyRoot(rootFolder);

  if (relativeDirectory !== undefined && relativeDirectory !== null) {
    if (typeof relativeDirectory !== "string") {
      throw new ProtocolError("INVALID_STATE", FILE_TREE_DIRECTORY_REQUIRED_MESSAGE, [
        `relativeDirectory=${String(relativeDirectory)}`,
      ]);
    }
  }

  const relative =
    typeof relativeDirectory === "string" ? relativeDirectory.trim() : "";
  const requested = relative === "" ? root : path.join(root, relative);
  const resolved = resolveCanonicalWorkspacePath(root, requested);
  if (!resolved.ok) {
    throw resolved.error;
  }

  let stats;
  try {
    stats = statSync(resolved.canonicalPath);
  } catch {
    throw new ProtocolError("INVALID_STATE", FILE_TREE_DIRECTORY_REQUIRED_MESSAGE, [
      `relativeDirectory=${relative}`,
    ]);
  }
  if (!stats.isDirectory()) {
    throw new ProtocolError("INVALID_STATE", FILE_TREE_DIRECTORY_REQUIRED_MESSAGE, [
      `relativeDirectory=${relative}`,
    ]);
  }

  const names = readdirSync(resolved.canonicalPath);
  const entries: FileTreeEntry[] = [];

  for (const name of names) {
    if (name === "." || name === "..") {
      continue;
    }
    const absoluteChild = path.join(resolved.canonicalPath, name);
    const childResolved = resolveCanonicalWorkspacePath(root, absoluteChild);
    if (!childResolved.ok) {
      // Symlink ou entrada que escapa o root: omitir sem abortar a listagem.
      continue;
    }
    let childStats;
    try {
      childStats = statSync(childResolved.canonicalPath);
    } catch {
      continue;
    }
    const childRelative = toPosixRelative(
      path.relative(root, childResolved.canonicalPath),
    );
    entries.push({
      name,
      relativePath: childRelative,
      kind: childStats.isDirectory() ? "directory" : "file",
    });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "en");
  });

  return entries;
}
