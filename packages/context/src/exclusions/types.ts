export const CONTEXT_EXCLUSION_SOURCES = ["project-ignore", "workspace-config"] as const;

export type ContextExclusionSource = (typeof CONTEXT_EXCLUSION_SOURCES)[number];

export type ContextExclusionPattern = {
  pattern: string;
  source: ContextExclusionSource;
};

export type ContextExclusionRuleset = {
  workspaceRoot: string;
  patterns: ContextExclusionPattern[];
};

export type ContextExclusionIncluded = {
  included: true;
  canonicalPath: string;
  relativePath: string;
};

export type ContextExclusionOmitted = {
  included: false;
  canonicalPath: string;
  relativePath: string;
  matchedPattern: string;
  source: ContextExclusionSource;
};

export type ContextExclusionCheckResult =
  | ContextExclusionIncluded
  | ContextExclusionOmitted;
