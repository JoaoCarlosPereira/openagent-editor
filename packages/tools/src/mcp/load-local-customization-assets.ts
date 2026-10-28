import path from "node:path";

import type {
  LoadedLocalCustomizationAsset,
  LocalCustomizationAssetLayer,
  LocalCustomizationAssetManifest,
} from "@openagent/policy";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  createNodeCustomizationRuleFileReader,
  type CustomizationRuleFileReader,
} from "./load-customization-rules.js";

const COMMAND_FILE_EXTENSIONS = new Set([".md", ".mdc", ".txt"]);
const SKILL_MANIFEST_FILE = "SKILL.md";
const PLUGIN_MANIFEST_FILE = "plugin.json";

export type LoadLocalCustomizationAssetsInput = {
  layer: LocalCustomizationAssetLayer;
  skillsDirectory: string;
  commandsDirectory: string;
  pluginsDirectory: string;
  originSkillsPrefix: string;
  originCommandsPrefix: string;
  originPluginsPrefix: string;
  precedence: number;
  reader?: CustomizationRuleFileReader;
};

function assetIdFromFileName(fileName: string): string {
  const ext = path.extname(fileName);
  return path.basename(fileName, ext);
}

function isCommandFileName(fileName: string): boolean {
  return COMMAND_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function stripYamlFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return content.trim();
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return content.trim();
  }
  return trimmed.slice(end + 4).trimStart();
}

function parsePluginManifestJson(
  raw: string,
  origin: string,
): { manifest: LocalCustomizationAssetManifest; instruction: string; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Manifesto de plugin inválido.",
      [`JSON ilegível em ${origin}.`],
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Manifesto de plugin inválido.",
      [`Estrutura inválida em ${origin}.`],
    );
  }
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const instruction =
    typeof record.instruction === "string" ? record.instruction.trim() : "";
  if (!name || !instruction) {
    throw new ProtocolError(
      PROTOCOL_ERROR_CODES.INVALID_STATE,
      "Manifesto de plugin inválido.",
      [`Campos 'name' e 'instruction' são obrigatórios em ${origin}.`],
    );
  }
  const manifest: LocalCustomizationAssetManifest = { name };
  if (typeof record.version === "string" && record.version.trim()) {
    manifest.version = record.version.trim();
  }
  if (typeof record.description === "string" && record.description.trim()) {
    manifest.description = record.description.trim();
  }
  return { manifest, instruction, id: name };
}

function collectCommandAssets(
  reader: CustomizationRuleFileReader,
  directoryPath: string,
  originPrefix: string,
  layer: LocalCustomizationAssetLayer,
  precedence: number,
): LoadedLocalCustomizationAsset[] {
  if (!reader.existsSync(directoryPath)) {
    return [];
  }
  const stat = reader.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return [];
  }

  const loaded: LoadedLocalCustomizationAsset[] = [];
  for (const entry of reader.readdirSync(directoryPath).sort((a, b) => a.localeCompare(b))) {
    const absolutePath = path.join(directoryPath, entry);
    const entryStat = reader.statSync(absolutePath);
    if (!entryStat.isFile() || !isCommandFileName(entry)) {
      continue;
    }
    const content = reader.readFileSync(absolutePath, "utf8").trim();
    if (!content) {
      continue;
    }
    loaded.push({
      id: assetIdFromFileName(entry),
      kind: "command",
      layer,
      origin: `${originPrefix}/${entry}`,
      instruction: content,
      precedence,
    });
  }
  return loaded;
}

function collectSkillAssets(
  reader: CustomizationRuleFileReader,
  directoryPath: string,
  originPrefix: string,
  layer: LocalCustomizationAssetLayer,
  precedence: number,
): LoadedLocalCustomizationAsset[] {
  if (!reader.existsSync(directoryPath)) {
    return [];
  }
  const stat = reader.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return [];
  }

  const loaded: LoadedLocalCustomizationAsset[] = [];
  for (const entry of reader.readdirSync(directoryPath).sort((a, b) => a.localeCompare(b))) {
    const skillDir = path.join(directoryPath, entry);
    const entryStat = reader.statSync(skillDir);
    if (!entryStat.isDirectory()) {
      continue;
    }
    const skillFile = path.join(skillDir, SKILL_MANIFEST_FILE);
    if (!reader.existsSync(skillFile)) {
      continue;
    }
    const fileStat = reader.statSync(skillFile);
    if (!fileStat.isFile()) {
      continue;
    }
    const raw = reader.readFileSync(skillFile, "utf8").trim();
    if (!raw) {
      continue;
    }
    loaded.push({
      id: entry,
      kind: "skill",
      layer,
      origin: `${originPrefix}/${entry}/${SKILL_MANIFEST_FILE}`,
      instruction: stripYamlFrontmatter(raw),
      precedence,
    });
  }
  return loaded;
}

function collectPluginAssets(
  reader: CustomizationRuleFileReader,
  directoryPath: string,
  originPrefix: string,
  layer: LocalCustomizationAssetLayer,
  precedence: number,
): LoadedLocalCustomizationAsset[] {
  if (!reader.existsSync(directoryPath)) {
    return [];
  }
  const stat = reader.statSync(directoryPath);
  if (!stat.isDirectory()) {
    return [];
  }

  const loaded: LoadedLocalCustomizationAsset[] = [];
  for (const entry of reader.readdirSync(directoryPath).sort((a, b) => a.localeCompare(b))) {
    const pluginDir = path.join(directoryPath, entry);
    const entryStat = reader.statSync(pluginDir);
    if (!entryStat.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE);
    if (!reader.existsSync(manifestPath)) {
      continue;
    }
    const fileStat = reader.statSync(manifestPath);
    if (!fileStat.isFile()) {
      continue;
    }
    const origin = `${originPrefix}/${entry}/${PLUGIN_MANIFEST_FILE}`;
    const raw = reader.readFileSync(manifestPath, "utf8");
    const { manifest, instruction, id } = parsePluginManifestJson(raw, origin);
    loaded.push({
      id,
      kind: "plugin",
      layer,
      origin,
      instruction,
      manifest,
      precedence,
    });
  }
  return loaded;
}

/** Descobre comandos, skills e plugins locais com manifesto e origem (CUS-02). */
export function loadLocalCustomizationAssetsFromPaths(
  input: LoadLocalCustomizationAssetsInput,
): LoadedLocalCustomizationAsset[] {
  const reader = input.reader ?? createNodeCustomizationRuleFileReader();
  const commands = collectCommandAssets(
    reader,
    input.commandsDirectory,
    input.originCommandsPrefix,
    input.layer,
    input.precedence,
  );
  const skills = collectSkillAssets(
    reader,
    input.skillsDirectory,
    input.originSkillsPrefix,
    input.layer,
    input.precedence,
  );
  const plugins = collectPluginAssets(
    reader,
    input.pluginsDirectory,
    input.originPluginsPrefix,
    input.layer,
    input.precedence,
  );
  return [...commands, ...skills, ...plugins].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
}
