import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { invalidToolInputError } from "../worker/tool-run-coordinator.js";
import {
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_FILES_SCANNED,
  MAX_SEARCH_HITS,
  MAX_SEARCH_QUERY_LENGTH,
  SEARCH_SKIP_DIR_NAMES,
} from "./limits.js";

export interface WorkspaceSearchHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchWorkspaceFilesResult {
  hits: WorkspaceSearchHit[];
  filesScanned: number;
  fileListTruncated: boolean;
  resultsTruncated: boolean;
  query: string;
}

function normalizeSearchQuery(raw: unknown): string {
  const query = String(raw ?? "").slice(0, MAX_SEARCH_QUERY_LENGTH).trim();
  if (!query) {
    throw invalidToolInputError("Consulta vazia.");
  }
  return query;
}

function collectCandidateFiles(
  workspaceRoot: string,
  relativeDir: string,
  collected: string[],
  truncated: { value: boolean },
): void {
  if (collected.length >= MAX_SEARCH_FILES_SCANNED) {
    truncated.value = true;
    return;
  }

  const absoluteDir = relativeDir
    ? path.join(workspaceRoot, relativeDir)
    : workspaceRoot;

  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (collected.length >= MAX_SEARCH_FILES_SCANNED) {
      truncated.value = true;
      return;
    }
    if (entry.isDirectory()) {
      if (SEARCH_SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      collectCandidateFiles(workspaceRoot, nextRelative, collected, truncated);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    collected.push(relativePath);
  }
}

export function searchWorkspaceFiles(
  workspaceRoot: string,
  queryInput: unknown,
): SearchWorkspaceFilesResult {
  const query = normalizeSearchQuery(queryInput);
  const queryLower = query.toLowerCase();

  const fileListTruncated = { value: false };
  const candidates: string[] = [];
  collectCandidateFiles(workspaceRoot, "", candidates, fileListTruncated);

  const hits: WorkspaceSearchHit[] = [];
  let filesScanned = 0;

  for (const relativePath of candidates) {
    if (hits.length >= MAX_SEARCH_HITS) {
      break;
    }
    filesScanned += 1;
    const absolutePath = path.join(workspaceRoot, relativePath);
    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) {
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(absolutePath);
    } catch {
      continue;
    }
    if (bytes.includes(0)) {
      continue;
    }

    const lines = bytes.toString("utf8").split("\n");
    for (let lineIndex = 0; lineIndex < lines.length && hits.length < MAX_SEARCH_HITS; lineIndex++) {
      const lineText = lines[lineIndex] ?? "";
      if (!lineText.toLowerCase().includes(queryLower)) {
        continue;
      }
      hits.push({
        path: relativePath,
        line: lineIndex + 1,
        text: lineText.slice(0, 200),
      });
    }
  }

  return {
    hits,
    filesScanned,
    fileListTruncated: fileListTruncated.value,
    resultsTruncated: hits.length >= MAX_SEARCH_HITS,
    query,
  };
}
