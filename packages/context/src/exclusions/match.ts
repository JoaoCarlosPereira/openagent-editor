import path from "node:path";

import type { ContextExclusionPattern, ContextExclusionRuleset } from "./types.js";

function globToRegExp(glob: string): RegExp {
  let escaped = "";
  for (const char of glob) {
    if (char === "*") {
      escaped += "[^/]*";
    } else if (char === "?") {
      escaped += "[^/]";
    } else {
      escaped += char.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`^${escaped}$`, "u");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function matchGitignorePattern(relativePath: string, rawPattern: string): boolean {
  let pattern = rawPattern.trim();
  if (pattern.length === 0) {
    return false;
  }

  let anchoredToRoot = false;
  if (pattern.startsWith("/")) {
    anchoredToRoot = true;
    pattern = pattern.slice(1);
  }

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) {
    pattern = pattern.slice(0, -1);
  }

  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const regex = globToRegExp(pattern);

  if (anchoredToRoot) {
    if (directoryOnly) {
      return normalized === pattern || normalized.startsWith(`${pattern}/`);
    }
    return regex.test(normalized);
  }

  if (pattern.includes("/")) {
    if (directoryOnly) {
      return normalized === pattern || normalized.startsWith(`${pattern}/`);
    }
    return regex.test(normalized);
  }

  if (directoryOnly) {
    return segments.some((segment) => regex.test(segment));
  }

  if (regex.test(normalized)) {
    return true;
  }
  return segments.some((segment) => regex.test(segment));
}

export function isRelativePathExcluded(
  relativePath: string,
  patterns: readonly ContextExclusionPattern[],
): ContextExclusionPattern | null {
  for (const entry of patterns) {
    if (matchGitignorePattern(relativePath, entry.pattern)) {
      return entry;
    }
  }
  return null;
}

export function relativePathFromCanonical(
  workspaceRoot: string,
  canonicalPath: string,
): string | null {
  const rootReal = path.resolve(workspaceRoot);
  const relative = path.relative(rootReal, canonicalPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.length === 0 ? "." : relative;
}

export function findExclusionMatch(
  ruleset: ContextExclusionRuleset,
  relativePath: string,
): ContextExclusionPattern | null {
  return isRelativePathExcluded(relativePath, ruleset.patterns);
}
