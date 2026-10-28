import type { ContextExclusionRuleset } from "../exclusions/types.js";

export type ContextIndexChunk = {
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  lexicalText: string;
};

export type IndexContextFileInput = {
  path: string;
  content: string;
  contentHash?: string;
  chunkSize?: number;
  exclusionRuleset?: ContextExclusionRuleset;
};

export type IndexContextFileResult = {
  path: string;
  contentHash: string;
  chunkCount: number;
  indexed: boolean;
  skippedReason?: "unchanged" | "excluded";
};

export type SearchContextIndexInput = {
  query: string;
  exclusionRuleset?: ContextExclusionRuleset;
};

export type ContextIndexSearchHit = {
  path: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  contentHash: string;
  lexicalSnippet: string;
};

export type SearchContextIndexResult = {
  query: string;
  hits: ContextIndexSearchHit[];
};
