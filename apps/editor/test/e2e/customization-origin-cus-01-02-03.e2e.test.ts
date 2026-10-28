import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LocalHookEngine,
  type LoadedCustomizationRule,
  type LoadedLocalCustomizationAsset,
} from "@openagent/policy";
import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";

import {
  CUSTOMIZATION_ORIGIN_HOOK_DENIED_MESSAGE,
  CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE,
  CUSTOMIZATION_ORIGIN_RULES_MESSAGE,
  CustomizationOriginController,
} from "../../src/permissions/customization-origin.js";

const USER_RULE: LoadedCustomizationRule = {
  id: "tone",
  layer: "user",
  origin: "~/.cursor/rules/tone.mdc",
  content: "Seja direto.",
  precedence: 1,
};

const PROJECT_RULE: LoadedCustomizationRule = {
  id: "tone",
  layer: "project",
  origin: ".cursor/rules/tone.mdc",
  content: "Seja direto e cite arquivos.",
  precedence: 2,
};

const EXTRA_USER_RULE: LoadedCustomizationRule = {
  id: "safety",
  layer: "user",
  origin: "~/.cursor/rules/safety.mdc",
  content: "Não execute rm -rf.",
  precedence: 1,
};

const SKILL_ASSET: LoadedLocalCustomizationAsset = {
  id: "deploy",
  kind: "skill",
  layer: "user",
  origin: "~/.cursor/skills/deploy/SKILL.md",
  instruction: "Gerar checklist de deploy sem tocar em produção.",
  precedence: 1,
};

const COMMAND_ASSET: LoadedLocalCustomizationAsset = {
  id: "lint-fix",
  kind: "command",
  layer: "project",
  origin: ".cursor/commands/lint-fix.md",
  instruction: "Rodar lint e resumir falhas.",
  precedence: 2,
};

const PLUGIN_ASSET: LoadedLocalCustomizationAsset = {
  id: "notes",
  kind: "plugin",
  layer: "project",
  origin: ".cursor/plugins/notes/plugin.json",
  instruction: "Anexar notas locais à sessão.",
  requestedCapabilities: ["file.read"],
  precedence: 2,
  manifest: { name: "notes", version: "1.0.0" },
};

describe("CUS-01/02/03 e2e — regras, skills e justificativa de hook", () => {
  it("[CUS-01] ao iniciar sessão carrega regras de usuário e projeto com origem", () => {
    const ui = new CustomizationOriginController();
    assert.equal(ui.phase, "idle");
    assert.match(ui.snapshot.html, /data-testid="customization-origin"/);

    const view = ui.acceptSessionRulesLoaded({
      workspaceRoot: "/tmp/ws-cus",
      rulesRef: "rules:default",
      sessionId: "sess-cus-01",
      userRules: [USER_RULE, EXTRA_USER_RULE],
      projectRules: [PROJECT_RULE],
    });

    assert.equal(view.accessible.phase, "rules_loaded");
    assert.equal(view.accessible.message, CUSTOMIZATION_ORIGIN_RULES_MESSAGE);
    assert.equal(view.accessible.actionBlocked, false);
    assert.equal(view.accessible.rules.length, 2);

    const tone = view.accessible.rules.find((rule) => rule.ruleId === "tone");
    const safety = view.accessible.rules.find((rule) => rule.ruleId === "safety");
    assert.ok(tone);
    assert.equal(tone.layer, "project");
    assert.equal(tone.origin, ".cursor/rules/tone.mdc");
    assert.ok(safety);
    assert.equal(safety.layer, "user");
    assert.equal(safety.origin, "~/.cursor/rules/safety.mdc");

    assert.match(view.html, /data-testid="customization-rules-list"/);
    assert.match(view.html, /data-testid="customization-rule-origin"/);
    assert.match(view.html, /\.cursor\/rules\/tone\.mdc/);
    assert.match(view.html, /~\/\.cursor\/rules\/safety\.mdc/);

    const emission = ui.rulesLoaded;
    assert.ok(emission);
    assert.equal(emission.type, "session.rules.loaded");
    assert.equal(emission.sessionId, "sess-cus-01");
    assert.equal(emission.loadedRules.length, 2);
  });

  it("[CUS-02] invocar skill/command/plugin aplica instrução e mostra origem", () => {
    const ui = new CustomizationOriginController();
    ui.acceptSessionRulesLoaded({
      workspaceRoot: "/tmp/ws-cus",
      rulesRef: "rules:default",
      sessionId: "sess-cus-02",
      userRules: [EXTRA_USER_RULE],
    });

    const skillView = ui.acceptCustomizationInvoked({
      sessionId: "sess-cus-02",
      invokeRef: "skill:deploy",
      assets: [SKILL_ASSET, COMMAND_ASSET, PLUGIN_ASSET],
    });
    assert.equal(skillView.accessible.phase, "asset_invoked");
    assert.equal(skillView.accessible.message, CUSTOMIZATION_ORIGIN_INVOKED_MESSAGE);
    assert.equal(skillView.accessible.invokedKind, "skill");
    assert.equal(skillView.accessible.invokedOrigin, "~/.cursor/skills/deploy/SKILL.md");
    assert.equal(
      skillView.accessible.invokedInstruction,
      "Gerar checklist de deploy sem tocar em produção.",
    );
    assert.match(skillView.html, /data-testid="customization-invoked"/);
    assert.match(skillView.html, /data-kind="skill"/);
    assert.match(skillView.html, /~\/\.cursor\/skills\/deploy\/SKILL\.md/);

    const commandView = ui.acceptCustomizationInvoked({
      sessionId: "sess-cus-02",
      invokeRef: "command:lint-fix",
      assets: [SKILL_ASSET, COMMAND_ASSET, PLUGIN_ASSET],
    });
    assert.equal(commandView.accessible.invokedKind, "command");
    assert.equal(commandView.accessible.invokedOrigin, ".cursor/commands/lint-fix.md");
    assert.equal(commandView.accessible.invokedInstruction, "Rodar lint e resumir falhas.");

    const pluginView = ui.acceptCustomizationInvoked({
      sessionId: "sess-cus-02",
      invokeRef: "plugin:notes",
      assets: [SKILL_ASSET, COMMAND_ASSET, PLUGIN_ASSET],
    });
    assert.equal(pluginView.accessible.invokedKind, "plugin");
    assert.equal(pluginView.accessible.invokedOrigin, ".cursor/plugins/notes/plugin.json");
    assert.equal(pluginView.accessible.invokedInstruction, "Anexar notas locais à sessão.");

    const emission = ui.lastInvocation;
    assert.ok(emission);
    assert.equal(emission.type, "local.customization.invoked");
    assert.equal(emission.invokeRef, "plugin:notes");
    assert.deepEqual(emission.declaredPluginCapabilities, ["file.read"]);
  });

  it("[CUS-03] hook local nega ação, impede execução e mostra justificativa", async () => {
    const engine = new LocalHookEngine([
      {
        id: "deny-shell",
        source: ".cursor/hooks.json",
        handler: (action) => {
          if (action.capability === "shell.exec") {
            return {
              decision: "deny",
              justification: "Comandos de shell bloqueados pela política interna.",
            };
          }
          return { decision: "allow" };
        },
      },
    ]);
    const ui = new CustomizationOriginController(engine);

    const blocked = await ui.attemptHookGuardedAction({
      capability: "shell.exec",
      target: { kind: "command", command: "rm -rf /" },
      runId: "run-cus-03",
      sessionId: "sess-cus-03",
    });
    assert.equal(blocked.outcome, "blocked");
    if (blocked.outcome !== "blocked") {
      return;
    }
    assert.equal(blocked.error.code, "PERMISSION_DENIED");
    assert.equal(ui.isActionBlocked, true);
    assert.equal(blocked.view.accessible.phase, "hook_denied");
    assert.equal(blocked.view.accessible.message, CUSTOMIZATION_ORIGIN_HOOK_DENIED_MESSAGE);
    assert.equal(
      blocked.view.accessible.hookJustification,
      "Comandos de shell bloqueados pela política interna.",
    );
    assert.equal(blocked.view.accessible.hookSource, ".cursor/hooks.json");
    assert.equal(blocked.denial.blocked, true);
    assert.match(blocked.view.html, /data-testid="customization-hook-denial"/);
    assert.match(blocked.view.html, /data-testid="customization-hook-justification"/);
    assert.match(blocked.view.html, /política interna/);
    assert.match(blocked.view.html, /data-action-blocked="true"/);

    const allowed = await ui.attemptHookGuardedAction({
      capability: "file.read",
      target: { kind: "path", path: "README.md" },
    });
    assert.equal(allowed.outcome, "allowed");
    assert.equal(ui.isActionBlocked, false);
  });

  it("[CUS-01] caminho de erro: entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
    const ui = new CustomizationOriginController();
    ui.acceptSessionRulesLoaded({
      workspaceRoot: "/tmp/ws-cus",
      rulesRef: "rules:default",
      sessionId: "sess-ok",
      userRules: [EXTRA_USER_RULE],
    });
    const before = ui.snapshot.html;
    const beforePhase = ui.phase;
    const beforeRules = ui.snapshot.accessible.rules.length;

    assert.throws(
      () =>
        ui.acceptSessionRulesLoaded({
          workspaceRoot: "",
          rulesRef: "rules:default",
          sessionId: "sess-bad",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () =>
        ui.acceptSessionRulesLoaded({
          workspaceRoot: "/tmp/ws",
          rulesRef: "not-a-rules-ref",
          sessionId: "sess-bad",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );
    assert.throws(
      () =>
        ui.acceptCustomizationInvoked({
          sessionId: "sess-ok",
          invokeRef: "invalid-ref",
          assets: [SKILL_ASSET],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError);
        assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
        return true;
      },
    );

    assert.equal(ui.phase, beforePhase);
    assert.equal(ui.snapshot.accessible.rules.length, beforeRules);
    assert.equal(ui.snapshot.html, before);
  });
});
