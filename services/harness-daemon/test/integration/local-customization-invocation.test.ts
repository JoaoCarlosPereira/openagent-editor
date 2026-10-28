import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  InMemoryGrantRegistry,
  LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE,
} from "@openagent/policy";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  createWorkspaceLocalCustomizationAssets,
  invokeWorkspaceLocalCustomization,
} from "../../src/index.js";

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test.describe("invocação local com origem e grant de plugin", { concurrency: 1 }, () => {
  test("[CUS-02] skill/command/plugin aplicam instrução e emitem origem", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-int-ws-"));
    const userBase = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-int-user-"));

    writeFile(
      path.join(userBase, "skills", "deploy", "SKILL.md"),
      "# Deploy\n\nInstrução de usuário.",
    );
    writeFile(
      path.join(workspaceRoot, ".cursor", "commands", "review.md"),
      "Revise o diff com atenção.",
    );
    writeFile(
      path.join(workspaceRoot, ".cursor", "plugins", "lint", "plugin.json"),
      JSON.stringify({
        name: "lint",
        instruction: "Execute lint no workspace.",
        requestedCapabilities: ["shell.exec", "file.write"],
      }),
    );

    const registry = createWorkspaceLocalCustomizationAssets();
    const sessionId = "ses-cus02-int-1";

    const skillOutcome = invokeWorkspaceLocalCustomization(registry, {
      invokeRef: "skill:deploy",
      sessionId,
      loadInput: { workspaceRoot, userBaseDirectory: userBase },
    });
    assert.equal(skillOutcome.invoked.type, LOCAL_CUSTOMIZATION_INVOKED_EVENT_TYPE);
    assert.match(skillOutcome.result.instruction, /Instrução de usuário\./);
    assert.equal(skillOutcome.invoked.display.origin, "~/.cursor/skills/deploy/SKILL.md");
    assert.deepEqual(skillOutcome.invoked.declaredPluginCapabilities, []);

    const commandOutcome = invokeWorkspaceLocalCustomization(registry, {
      invokeRef: "command:review",
      sessionId,
      loadInput: { workspaceRoot, userBaseDirectory: userBase },
    });
    assert.equal(commandOutcome.result.instruction, "Revise o diff com atenção.");
    assert.equal(commandOutcome.invoked.display.origin, ".cursor/commands/review.md");

    const pluginOutcome = invokeWorkspaceLocalCustomization(registry, {
      invokeRef: "plugin:lint",
      sessionId,
      loadInput: { workspaceRoot, userBaseDirectory: userBase },
    });
    assert.equal(pluginOutcome.result.instruction, "Execute lint no workspace.");
    assert.equal(pluginOutcome.invoked.display.origin, ".cursor/plugins/lint/plugin.json");
    assert.deepEqual(pluginOutcome.invoked.declaredPluginCapabilities, [
      "shell.exec",
      "file.write",
    ]);
  });

  test("[CUS-02] plugin com capabilities declaradas não amplia grant (PER-01)", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-grant-ws-"));
    writeFile(
      path.join(workspaceRoot, ".cursor", "plugins", "deploy", "plugin.json"),
      JSON.stringify({
        name: "deploy",
        instruction: "Publique artefatos.",
        requestedCapabilities: ["shell.exec"],
      }),
    );

    const grantRegistry = new InMemoryGrantRegistry();
    const grantContext = {
      nowMs: 1_700_000_000_000,
      sessionId: "ses-grant-guard",
      workspaceId: "ws-grant-guard",
    };

    const assetsRegistry = createWorkspaceLocalCustomizationAssets();
    const outcome = invokeWorkspaceLocalCustomization(assetsRegistry, {
      invokeRef: "plugin:deploy",
      sessionId: grantContext.sessionId,
      loadInput: { workspaceRoot },
    });

    assert.equal(outcome.result.instruction, "Publique artefatos.");
    assert.deepEqual(outcome.invoked.declaredPluginCapabilities, ["shell.exec"]);
    assert.equal(
      grantRegistry.findActiveGrant(
        "shell.exec",
        { kind: "command", command: "npm publish" },
        grantContext,
      ),
      undefined,
    );
  });

  test("[CUS-02] caminho de erro: invokeRef inválido retorna INVALID_STATE", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-cus02-err-ws-"));
    const registry = createWorkspaceLocalCustomizationAssets();

    assert.throws(
      () =>
        invokeWorkspaceLocalCustomization(registry, {
          invokeRef: "not-valid",
          sessionId: "ses-err",
          loadInput: { workspaceRoot },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
  });
});
