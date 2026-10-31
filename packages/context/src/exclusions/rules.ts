import fs from "node:fs";
import path from "node:path";

import {
  outOfScopePathError,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";
import { resolveCanonicalWorkspacePath } from "@openagent/policy";

import type { ContextAttachmentDraft } from "../attachments/types.js";
import { parseGitignoreLines } from "./gitignore.js";
import {
  findExclusionMatch,
  relativePathFromCanonical,
} from "./match.js";
import type {
  ContextExclusionCheckResult,
  ContextExclusionPattern,
  ContextExclusionRuleset,
} from "./types.js";

export type WorkspaceExclusionParseResult =
  | { valid: true; patterns: string[] }
  | { valid: false; code: typeof PROTOCOL_ERROR_CODES.INVALID_STATE; errors: string[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Interpreta workspace.exclusions_json (array JSON de padrões glob).
 */
export function parseWorkspaceExclusionPatterns(raw: unknown): WorkspaceExclusionParseResult {
  if (raw === undefined || raw === null) {
    return { valid: true, patterns: [] };
  }
  if (typeof raw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        valid: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: ["Campo 'exclusions_json' deve ser JSON válido (array de strings)."],
      };
    }
    return parseWorkspaceExclusionPatterns(parsed);
  }
  if (!Array.isArray(raw)) {
    return {
      valid: false,
      code: PROTOCOL_ERROR_CODES.INVALID_STATE,
      errors: ["Campo 'exclusions' deve ser um array JSON de strings."],
    };
  }
  const patterns: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!isNonEmptyString(entry)) {
      return {
        valid: false,
        code: PROTOCOL_ERROR_CODES.INVALID_STATE,
        errors: [`exclusions[${index}] deve ser string não-vazia.`],
      };
    }
    patterns.push(entry.trim());
  }
  return { valid: true, patterns };
}

export function loadProjectGitignorePatterns(workspaceRoot: string): string[] {
  const gitignorePath = path.join(path.resolve(workspaceRoot), ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }
  const content = fs.readFileSync(gitignorePath, "utf8");
  return parseGitignoreLines(content);
}

export type BuildContextExclusionRulesInput = {
  workspaceRoot: string;
  workspaceExclusionPatterns?: unknown;
  projectIgnorePatterns?: string[];
};

/**
 * Combina ignore do projeto (.gitignore) e padrões gravados no workspace.
 */
export function buildContextExclusionRules(
  input: BuildContextExclusionRulesInput,
): ContextExclusionRuleset | WorkspaceExclusionParseResult {
  const workspaceRoot = input.workspaceRoot.trim();
  const configParsed = parseWorkspaceExclusionPatterns(
    input.workspaceExclusionPatterns ?? [],
  );
  if (!configParsed.valid) {
    return configParsed;
  }

  const projectPatterns =
    input.projectIgnorePatterns ?? loadProjectGitignorePatterns(workspaceRoot);

  const patterns: ContextExclusionPattern[] = [
    ...projectPatterns.map((pattern) => ({
      pattern,
      source: "project-ignore" as const,
    })),
    ...configParsed.patterns.map((pattern) => ({
      pattern,
      source: "workspace-config" as const,
    })),
  ];

  return {
    workspaceRoot,
    patterns,
  };
}

export type EvaluateContextPathExclusionInput = {
  ruleset: ContextExclusionRuleset;
  requestedPath: string;
};

/**
 * Avalia se um caminho (após canonicalização) deve ser omitido de indexação, contexto e busca (CTX-03).
 */
export function evaluateContextPathExclusion(
  input: EvaluateContextPathExclusionInput,
): ContextExclusionCheckResult | { error: ProtocolError } {
  const resolution = resolveCanonicalWorkspacePath(
    input.ruleset.workspaceRoot,
    input.requestedPath,
  );
  if (!resolution.ok) {
    return { error: resolution.error };
  }

  const relativePath = relativePathFromCanonical(
    input.ruleset.workspaceRoot,
    resolution.canonicalPath,
  );
  if (relativePath === null) {
    return { error: outOfScopePathError(input.requestedPath) };
  }

  const match = findExclusionMatch(input.ruleset, relativePath);
  if (match === null) {
    return {
      included: true,
      canonicalPath: resolution.canonicalPath,
      relativePath,
    };
  }

  return {
    included: false,
    canonicalPath: resolution.canonicalPath,
    relativePath,
    matchedPattern: match.pattern,
    source: match.source,
  };
}

/**
 * Filtra caminhos elegíveis para indexação, contexto automático e busca do agente.
 */
export function filterIncludedContextPaths(
  ruleset: ContextExclusionRuleset,
  requestedPaths: readonly string[],
): string[] {
  const included: string[] = [];
  for (const requestedPath of requestedPaths) {
    const result = evaluateContextPathExclusion({ ruleset, requestedPath });
    if ("error" in result) {
      continue;
    }
    if (result.included) {
      included.push(result.canonicalPath);
    }
  }
  return included;
}

/**
 * Monta ruleset de exclusão ou lança INVALID_STATE (CTX-03 caminho de erro).
 */
export function resolveContextExclusionRuleset(
  input: BuildContextExclusionRulesInput,
): ContextExclusionRuleset {
  const built = buildContextExclusionRules(input);
  if ("valid" in built) {
    if (!built.valid) {
      throw new ProtocolError(built.code, built.errors.join(" "));
    }
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Ruleset de exclusão inválido.",
    );
  }
  return built;
}

/**
 * Remove anexos cujo caminho está excluído (contexto automático / attach, CTX-03).
 */
export function filterIncludedContextAttachmentDrafts(
  ruleset: ContextExclusionRuleset,
  attachments: readonly ContextAttachmentDraft[],
): ContextAttachmentDraft[] {
  const included: ContextAttachmentDraft[] = [];
  for (const attachment of attachments) {
    const result = evaluateContextPathExclusion({
      ruleset,
      requestedPath: attachment.path,
    });
    if ("error" in result || !result.included) {
      continue;
    }
    included.push(attachment);
  }
  return included;
}
