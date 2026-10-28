import assert from "node:assert/strict";
import test from "node:test";

import { loadLocalCustomizationAssetsFromPaths } from "../../src/mcp/load-local-customization-assets.js";
import type { CustomizationRuleFileReader } from "../../src/mcp/load-customization-rules.js";

type FakeEntry = { type: "file" | "dir"; content?: string };

function createFakeReader(tree: Record<string, FakeEntry>): CustomizationRuleFileReader {
  return {
    existsSync(filePath: string): boolean {
      return Object.prototype.hasOwnProperty.call(tree, filePath);
    },
    readFileSync(filePath: string): string {
      const entry = tree[filePath];
      if (!entry || entry.type !== "file") {
        throw new Error(`missing file ${filePath}`);
      }
      return entry.content ?? "";
    },
    readdirSync(dirPath: string): string[] {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const names = new Set<string>();
      for (const key of Object.keys(tree)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment) {
          names.add(segment);
        }
      }
      return [...names].sort();
    },
    statSync(filePath: string): { isFile(): boolean; isDirectory(): boolean } {
      const entry = tree[filePath];
      if (!entry) {
        throw new Error(`missing path ${filePath}`);
      }
      return {
        isFile: () => entry.type === "file",
        isDirectory: () => entry.type === "dir",
      };
    },
  };
}

test("[CUS-02] loader descobre command, skill e plugin com origem", () => {
  const skillsDir = "/home/user/.cursor/skills";
  const commandsDir = "/home/user/.cursor/commands";
  const pluginsDir = "/home/user/.cursor/plugins";

  const reader = createFakeReader({
    [skillsDir]: { type: "dir" },
    [`${skillsDir}/lint`]: { type: "dir" },
    [`${skillsDir}/lint/SKILL.md`]: {
      type: "file",
      content: "---\nname: lint\n---\n\nRode eslint.",
    },
    [commandsDir]: { type: "dir" },
    [`${commandsDir}/ship.md`]: { type: "file", content: "Publique o pacote." },
    [pluginsDir]: { type: "dir" },
    [`${pluginsDir}/qa`]: { type: "dir" },
    [`${pluginsDir}/qa/plugin.json`]: {
      type: "file",
      content: JSON.stringify({
        name: "qa",
        version: "1.0.0",
        instruction: "Execute smoke QA.",
      }),
    },
  });

  const loaded = loadLocalCustomizationAssetsFromPaths({
    layer: "user",
    skillsDirectory: skillsDir,
    commandsDirectory: commandsDir,
    pluginsDirectory: pluginsDir,
    originSkillsPrefix: "~/.cursor/skills",
    originCommandsPrefix: "~/.cursor/commands",
    originPluginsPrefix: "~/.cursor/plugins",
    precedence: 1,
    reader,
  });

  assert.equal(loaded.length, 3);
  const skill = loaded.find((asset) => asset.kind === "skill");
  assert.ok(skill);
  assert.equal(skill?.origin, "~/.cursor/skills/lint/SKILL.md");
  assert.equal(skill?.instruction, "Rode eslint.");

  const command = loaded.find((asset) => asset.kind === "command");
  assert.ok(command);
  assert.equal(command?.origin, "~/.cursor/commands/ship.md");

  const plugin = loaded.find((asset) => asset.kind === "plugin");
  assert.ok(plugin);
  assert.equal(plugin?.manifest?.version, "1.0.0");
  assert.equal(plugin?.origin, "~/.cursor/plugins/qa/plugin.json");
});
