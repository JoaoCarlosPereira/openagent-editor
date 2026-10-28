import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { resolveCanonicalWorkspacePath } from "@openagent/policy";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import type { RegisteredLocalEmbeddingModel } from "../embeddings/types.js";
import type { ContextExclusionRuleset } from "../exclusions/types.js";
import { indexContextFile } from "./index-context-file.js";
import type { IndexContextFileResult } from "./types.js";

export type ReindexContextFileOnSaveInput = {
  workspaceRoot: string;
  relativePath: string;
  exclusionRuleset?: ContextExclusionRuleset;
  embeddingModel?: RegisteredLocalEmbeddingModel;
};

function reindexInvalid(message: string, details?: string[]): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_STATE, message, details);
}

function requireRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    reindexInvalid("path inválido para reindexação ao salvar.");
  }
  if (path.isAbsolute(trimmed)) {
    reindexInvalid("path inválido para reindexação ao salvar.");
  }
  return trimmed;
}

function readSavedWorkspaceFileText(
  workspaceRoot: string,
  relativePath: string,
): string {
  const resolved = resolveCanonicalWorkspacePath(workspaceRoot, relativePath);
  if (!resolved.ok) {
    throw resolved.error;
  }

  let stat;
  try {
    stat = statSync(resolved.canonicalPath);
  } catch {
    reindexInvalid("O caminho não aponta para um arquivo salvo.");
  }
  if (!stat.isFile()) {
    reindexInvalid("O caminho não aponta para um arquivo salvo.");
  }

  const bytes = readFileSync(resolved.canonicalPath);
  if (bytes.includes(0)) {
    reindexInvalid("Arquivo binário não suportado para indexação.");
  }

  return bytes.toString("utf8");
}

/**
 * Reindexação incremental ao salvar arquivo (CTX-02): lê o conteúdo do disco e
 * atualiza apenas os chunks do path informado.
 */
export function reindexContextFileOnSave(
  database: DatabaseSync,
  input: ReindexContextFileOnSaveInput,
): IndexContextFileResult {
  if (typeof input.workspaceRoot !== "string" || !input.workspaceRoot.trim()) {
    reindexInvalid("workspaceRoot inválido para reindexação ao salvar.");
  }

  const relativePath = requireRelativePath(input.relativePath);
  const content = readSavedWorkspaceFileText(input.workspaceRoot, relativePath);

  return indexContextFile(database, {
    path: relativePath,
    content,
    exclusionRuleset: input.exclusionRuleset,
    embeddingModel: input.embeddingModel,
  });
}
