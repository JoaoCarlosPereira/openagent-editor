import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { resolveCanonicalWorkspacePath } from "@openagent/policy";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import { MAX_READ_FILE_BYTES, MAX_READ_FILE_CHARS } from "./limits.js";

export interface ReadWorkspaceFileResult {
  content: string;
  path: string;
  truncated: boolean;
}

function assertRelativeFilePath(relativePath: string): void {
  if (!relativePath.trim()) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
  if (path.isAbsolute(relativePath)) {
    throw invalidToolInputError("Caminho relativo inválido.");
  }
}

export function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): ReadWorkspaceFileResult {
  assertRelativeFilePath(relativePath);
  const resolved = resolveCanonicalWorkspacePath(workspaceRoot, relativePath);
  if (!resolved.ok) {
    throw resolved.error;
  }

  let stat;
  try {
    stat = statSync(resolved.canonicalPath);
  } catch {
    throw invalidToolInputError("O caminho não aponta para um arquivo.");
  }
  if (!stat.isFile()) {
    throw invalidToolInputError("O caminho não aponta para um arquivo.");
  }
  if (stat.size > MAX_READ_FILE_BYTES) {
    throw invalidToolInputError("Arquivo maior que 1 MiB; reduza o escopo.");
  }

  const bytes = readFileSync(resolved.canonicalPath);
  if (bytes.includes(0)) {
    throw invalidToolInputError("Arquivo binário não suportado.");
  }

  const fullText = bytes.toString("utf8");
  const truncated = fullText.length > MAX_READ_FILE_CHARS;
  const content = truncated ? fullText.slice(0, MAX_READ_FILE_CHARS) : fullText;

  return {
    content,
    path: relativePath.trim(),
    truncated,
  };
}
