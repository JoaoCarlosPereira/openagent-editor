import fs from "node:fs";
import path from "node:path";

import type { CustomizationRuleLayer, LoadedCustomizationRule } from "@openagent/policy";

const RULE_FILE_EXTENSIONS = new Set([".md", ".mdc", ".txt"]);

export type CustomizationRuleFileReader = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
};

export function createNodeCustomizationRuleFileReader(): CustomizationRuleFileReader {
  return fs;
}

function ruleIdFromFileName(fileName: string): string {
  const ext = path.extname(fileName);
  return path.basename(fileName, ext);
}

function isRuleFileName(fileName: string): boolean {
  return RULE_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function collectRuleFilesFromDirectory(
  reader: CustomizationRuleFileReader,
  directoryPath: string,
  originPrefix: string,
  layer: CustomizationRuleLayer,
  precedence: number,
): LoadedCustomizationRule[] {
  if (!reader.existsSync(directoryPath)) {
    return [];
  }
  const stat = reader.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return [];
  }

  const loaded: LoadedCustomizationRule[] = [];
  const entries = reader.readdirSync(directoryPath).sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry);
    const entryStat = reader.statSync(absolutePath);
    if (!entryStat.isFile() || !isRuleFileName(entry)) {
      continue;
    }
    const content = reader.readFileSync(absolutePath, "utf8").trim();
    if (!content) {
      continue;
    }
    loaded.push({
      id: ruleIdFromFileName(entry),
      layer,
      origin: `${originPrefix}/${entry}`,
      content,
      precedence,
    });
  }
  return loaded;
}

function loadLegacyProjectRuleFile(
  reader: CustomizationRuleFileReader,
  legacyFilePath: string,
): LoadedCustomizationRule[] {
  if (!reader.existsSync(legacyFilePath)) {
    return [];
  }
  const stat = reader.statSync(legacyFilePath);
  if (!stat.isFile()) {
    return [];
  }
  const content = reader.readFileSync(legacyFilePath, "utf8").trim();
  if (!content) {
    return [];
  }
  return [
    {
      id: "cursorrules",
      layer: "project",
      origin: ".cursorrules",
      content,
      precedence: 2,
    },
  ];
}

export type LoadCustomizationRulesFromPathsInput = {
  layer: CustomizationRuleLayer;
  rulesDirectory?: string;
  legacyFilePath?: string;
  originPrefix: string;
  precedence: number;
  reader?: CustomizationRuleFileReader;
};

/** Descobre arquivos de regra locais (paridade com layout `.cursor/rules`). */
export function loadCustomizationRulesFromPaths(
  input: LoadCustomizationRulesFromPathsInput,
): LoadedCustomizationRule[] {
  const reader = input.reader ?? createNodeCustomizationRuleFileReader();
  const fromDirectory =
    input.rulesDirectory !== undefined
      ? collectRuleFilesFromDirectory(
          reader,
          input.rulesDirectory,
          input.originPrefix,
          input.layer,
          input.precedence,
        )
      : [];

  if (input.layer !== "project" || input.legacyFilePath === undefined) {
    return fromDirectory;
  }

  const legacy = loadLegacyProjectRuleFile(reader, input.legacyFilePath);
  const merged = new Map<string, LoadedCustomizationRule>();
  for (const rule of legacy) {
    merged.set(rule.id, rule);
  }
  for (const rule of fromDirectory) {
    merged.set(rule.id, rule);
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}
