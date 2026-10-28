import assert from "node:assert/strict";
import test from "node:test";

import { loadLocalCustomizationAssetsFromPaths } from "@openagent/tools";

import {
  LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE,
  invokeLocalCustomizationWithGrantPolicy,
} from "../../src/index.js";

test("[CUS-02] integração policy+loader: invoca plugin e expõe capabilities declaradas", () => {
  const reader = {
    existsSync: (p: string) =>
      p.endsWith("plugins/deploy/plugin.json") || p.endsWith("/plugins") || p.endsWith("/deploy"),
    statSync: (p: string) => ({
      isDirectory: () => !p.endsWith("plugin.json"),
      isFile: () => p.endsWith("plugin.json"),
    }),
    readdirSync: (p: string) => (p.endsWith("/plugins") ? ["deploy"] : []),
    readFileSync: (p: string) => {
      if (!p.endsWith("plugin.json")) {
        return "";
      }
      return JSON.stringify({
        name: "deploy",
        instruction: "Publique.",
        requestedCapabilities: ["shell.exec"],
      });
    },
  };

  const assets = loadLocalCustomizationAssetsFromPaths({
    layer: "project",
    skillsDirectory: "/tmp/skills",
    commandsDirectory: "/tmp/commands",
    pluginsDirectory: "/tmp/plugins",
    originSkillsPrefix: ".cursor/skills",
    originCommandsPrefix: ".cursor/commands",
    originPluginsPrefix: ".cursor/plugins",
    precedence: 2,
    reader,
  });

  const outcome = invokeLocalCustomizationWithGrantPolicy(assets, "plugin:deploy", {
    sessionId: "ses-int-policy",
  });

  assert.equal(outcome.invoked.type, LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE);
  assert.equal(outcome.result.instruction, "Publique.");
  assert.equal(outcome.invoked.display.origin, ".cursor/plugins/deploy/plugin.json");
  assert.deepEqual(outcome.invoked.declaredPluginCapabilities, ["shell.exec"]);
});
