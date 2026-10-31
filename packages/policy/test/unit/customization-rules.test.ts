import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  SESSION_RULES_LOADED_EVENT_TYPE,
  buildSessionRulesLoadedEmission,
  formatCustomizationRulesForDisplay,
  mergeCustomizationRulesByPrecedence,
  validateSessionRulesLoadInput,
  type LoadedCustomizationRule,
} from "../../src/index.js";

test("[CUS-01] mescla regras de usuário e projeto com precedência do projeto", () => {
  const userRules: LoadedCustomizationRule[] = [
    {
      id: "shared",
      layer: "user",
      origin: "~/.cursor/rules/shared.mdc",
      content: "user",
      precedence: 1,
    },
    {
      id: "user-only",
      layer: "user",
      origin: "~/.cursor/rules/user-only.mdc",
      content: "only user",
      precedence: 1,
    },
  ];
  const projectRules: LoadedCustomizationRule[] = [
    {
      id: "shared",
      layer: "project",
      origin: ".cursor/rules/shared.mdc",
      content: "project",
      precedence: 2,
    },
  ];

  const merged = mergeCustomizationRulesByPrecedence(userRules, projectRules);
  assert.equal(merged.length, 2);
  const shared = merged.find((rule) => rule.id === "shared");
  assert.ok(shared);
  assert.equal(shared?.layer, "project");
  assert.equal(shared?.precedence, 2);
  assert.equal(shared?.content, "project");
});

test("[CUS-01] exibe origem de cada regra carregada", () => {
  const display = formatCustomizationRulesForDisplay([
    {
      id: "style",
      layer: "project",
      origin: ".cursor/rules/style.mdc",
      content: "Use TypeScript.",
      precedence: 2,
    },
  ]);
  assert.deepEqual(display, [
    {
      ruleId: "style",
      layer: "project",
      origin: ".cursor/rules/style.mdc",
      precedence: 2,
    },
  ]);
});

test("[CUS-01] emissão session.rules.loaded inclui origem de cada regra", () => {
  const display = formatCustomizationRulesForDisplay([
    {
      id: "global",
      layer: "user",
      origin: "~/.cursor/rules/global.mdc",
      content: "x",
      precedence: 1,
    },
  ]);
  const emission = buildSessionRulesLoadedEmission({
    sessionId: "ses-emit",
    rulesRef: "rules:project/default",
    loadedRules: display,
    emittedAt: 1_700_000_000_000,
  });
  assert.equal(emission.type, SESSION_RULES_LOADED_EVENT_TYPE);
  assert.equal(emission.sessionId, "ses-emit");
  assert.deepEqual(emission.loadedRules, display);
});

test("[CUS-01] caminho de erro: rulesRef inválido retorna INVALID_STATE", () => {
  assert.throws(
    () =>
      validateSessionRulesLoadInput({
        workspaceRoot: "/tmp/ws",
        rulesRef: "invalid",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
