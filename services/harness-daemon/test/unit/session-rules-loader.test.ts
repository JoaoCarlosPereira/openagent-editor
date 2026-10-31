import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  WorkspaceCustomizationRules,
  loadSessionCustomizationRules,
} from "../../src/customization/session-rules-loader.js";

function writeRuleFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("[CUS-01] ao iniciar sessão carrega regras de usuário e projeto com origem", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rules-ws-"));
  const userRulesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rules-user-"));

  writeRuleFile(path.join(userRulesDirectory, "global.mdc"), "Sempre responda em PT-BR.");
  writeRuleFile(
    path.join(workspaceRoot, ".cursor", "rules", "project.mdc"),
    "Prefira testes unitários.",
  );

  const snapshot = loadSessionCustomizationRules({
    workspaceRoot,
    sessionId: "ses-cus01",
    rulesRef: "rules:project/default",
    userRulesDirectory,
  });

  assert.equal(snapshot.display.length, 2);
  const origins = snapshot.display.map((entry) => entry.origin).sort();
  assert.deepEqual(origins, [
    ".cursor/rules/project.mdc",
    "~/.cursor/rules/global.mdc",
  ]);
  assert.ok(snapshot.display.some((entry) => entry.layer === "user"));
  assert.ok(snapshot.display.some((entry) => entry.layer === "project"));
});

test("[CUS-01] regra de projeto sobrescreve regra de usuário com o mesmo id", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rules-ws2-"));
  const userRulesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rules-user2-"));

  writeRuleFile(path.join(userRulesDirectory, "team.mdc"), "User team rule");
  writeRuleFile(path.join(workspaceRoot, ".cursor", "rules", "team.mdc"), "Project team rule");

  const registry = new WorkspaceCustomizationRules();
  const snapshot = registry.beginSession({
    workspaceRoot,
    sessionId: "ses-precedence",
    rulesRef: "rules:project/default",
    userRulesDirectory,
  });

  assert.equal(snapshot.mergedRules.length, 1);
  assert.equal(snapshot.mergedRules[0]?.layer, "project");
  assert.equal(snapshot.mergedRules[0]?.content, "Project team rule");
  assert.deepEqual(registry.getSessionDisplay("ses-precedence"), snapshot.display);
});

test("[CUS-01] caminho de erro: workspaceRoot vazio retorna INVALID_STATE", () => {
  assert.throws(
    () =>
      loadSessionCustomizationRules({
        workspaceRoot: "   ",
        sessionId: "ses-invalid",
        rulesRef: "rules:project/default",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
