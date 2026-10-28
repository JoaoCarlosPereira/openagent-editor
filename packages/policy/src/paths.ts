import fs from "node:fs";
import path from "node:path";

import {
  outOfScopePathError,
  PROTOCOL_ERROR_CODES,
  type ProtocolError,
} from "@openagent/protocol";

import type { PolicyValidationResult } from "./types.js";

/** Mensagem estável registrada quando ERR-02 nega a operação. */
export const OUT_OF_SCOPE_PATH_LOG_MESSAGE = "Caminho fora do escopo." as const;

export type WorkspacePathResolution =
  | { ok: true; canonicalPath: string }
  | { ok: false; error: ProtocolError };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Verifica confinamento usando caminhos absolutos já normalizados (sem seguir symlinks). */
export function isAbsolutePathInsideRoot(
  workspaceRootAbsolute: string,
  candidateAbsolute: string,
): boolean {
  const relative = path.relative(workspaceRootAbsolute, candidateAbsolute);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveExistingRealPath(absolutePath: string): string {
  try {
    return fs.realpathSync.native(absolutePath);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code !== "ENOENT") {
      throw error;
    }
    const parent = path.dirname(absolutePath);
    if (parent === absolutePath) {
      throw error;
    }
    const parentReal = fs.realpathSync.native(parent);
    return path.join(parentReal, path.basename(absolutePath));
  }
}

export function validateWorkspacePathInputs(
  workspaceRoot: unknown,
  requestedPath: unknown,
): PolicyValidationResult<{ workspaceRoot: string; requestedPath: string }> {
  if (!isNonEmptyString(workspaceRoot)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'workspaceRoot' ausente ou inválido (string não-vazia)."],
    };
  }
  if (!isNonEmptyString(requestedPath)) {
    return {
      valid: false,
      code: "INVALID_STATE",
      errors: ["Campo 'requestedPath' ausente ou inválido (string não-vazia)."],
    };
  }
  return {
    valid: true,
    value: {
      workspaceRoot: workspaceRoot.trim(),
      requestedPath: requestedPath.trim(),
    },
  };
}

/**
 * Canonicaliza um caminho de ferramenta dentro do workspace aprovado.
 * Segue symlinks na resolução; nega com OUT_OF_SCOPE quando o destino real escapa do root.
 */
export function resolveCanonicalWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
): WorkspacePathResolution {
  let workspaceReal: string;
  try {
    workspaceReal = fs.realpathSync.native(path.resolve(workspaceRoot));
  } catch {
    return {
      ok: false,
      error: outOfScopePathError(requestedPath),
    };
  }

  const absoluteCandidate = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspaceReal, requestedPath);

  if (!isAbsolutePathInsideRoot(workspaceReal, absoluteCandidate)) {
    return {
      ok: false,
      error: outOfScopePathError(requestedPath),
    };
  }

  let canonicalPath: string;
  try {
    canonicalPath = resolveExistingRealPath(absoluteCandidate);
  } catch {
    return {
      ok: false,
      error: outOfScopePathError(requestedPath),
    };
  }

  if (!isAbsolutePathInsideRoot(workspaceReal, canonicalPath)) {
    return {
      ok: false,
      error: outOfScopePathError(requestedPath),
    };
  }

  return { ok: true, canonicalPath };
}

/** Extrai a linha de log estável de uma negação ERR-02. */
export function formatOutOfScopePathLog(error: ProtocolError): string {
  if (error.code !== PROTOCOL_ERROR_CODES.OUT_OF_SCOPE) {
    return error.message;
  }
  return OUT_OF_SCOPE_PATH_LOG_MESSAGE;
}
