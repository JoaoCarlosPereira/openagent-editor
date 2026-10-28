import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  WorkspaceLocalCustomizationAssets,
  loadWorkspaceLocalCustomizationAssets,
} from "../../src/customization/local-customization-loader.js";

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("[CUS-02] ao invocar skill local aplica instrução e mostra origem", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-ws-"));
  const userBase = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-user-"));

  writeFile(
    path.join(userBase, "skills", "deploy", "SKILL.md"),
    "# Deploy\n\nPublique com npm publish.",
  );
  writeFile(
    path.join(workspaceRoot, ".cursor", "skills", "deploy", "SKILL.md"),
    "# Deploy projeto\n\nUse npm run release.",
  );

  const registry = new WorkspaceLocalCustomizationAssets();
  registry.reload({ workspaceRoot, userBaseDirectory: userBase });

  const result = registry.invoke("skill:deploy");
  assert.match(result.instruction, /Use npm run release\./);
  assert.equal(result.display.origin, ".cursor/skills/deploy/SKILL.md");
  assert.equal(result.display.layer, "project");
});

test("[CUS-02] invoca command e plugin carregados do workspace", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-ws2-"));
  const userBase = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-user2-"));

  writeFile(path.join(workspaceRoot, ".cursor", "commands", "review.md"), "Revise o diff.");
  writeFile(
    path.join(workspaceRoot, ".cursor", "plugins", "lint", "plugin.json"),
    JSON.stringify({ name: "lint", instruction: "Rode lint no projeto." }),
  );

  const assets = loadWorkspaceLocalCustomizationAssets({
    workspaceRoot,
    userBaseDirectory: userBase,
  });

  const command = assets.find((asset) => asset.kind === "command");
  assert.ok(command);
  const registry = new WorkspaceLocalCustomizationAssets();
  registry.reload({ workspaceRoot, userBaseDirectory: userBase });
  const commandResult = registry.invoke(`command:${command.id}`);
  assert.equal(commandResult.instruction, "Revise o diff.");
  assert.equal(commandResult.display.origin, ".cursor/commands/review.md");

  const pluginResult = registry.invoke("plugin:lint");
  assert.equal(pluginResult.instruction, "Rode lint no projeto.");
  assert.equal(pluginResult.display.manifest?.name, "lint");
});

test("[CUS-02] caminho de erro: invokeRef inválido retorna INVALID_STATE", () => {
  const registry = new WorkspaceLocalCustomizationAssets();
  registry.reload({
    workspaceRoot: fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-empty-")),
  });

  assert.throws(
    () => registry.invoke("not-a-valid-ref"),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
