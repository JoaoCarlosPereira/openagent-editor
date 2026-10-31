import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PROTOCOL_ERROR_CODES } from "@openagent/protocol";

import {
  buildContextExclusionRules,
  evaluateContextPathExclusion,
  filterIncludedContextPaths,
  parseWorkspaceExclusionPatterns,
} from "../../src/index.js";

function withWorkspace(
  fn: (root: string) => void,
  gitignore?: string,
): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "openagent-ctx-excl-"));
  try {
    if (gitignore !== undefined) {
      writeFileSync(path.join(root, ".gitignore"), gitignore, "utf8");
    }
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(root, "src", "app.ts"), "export {};\n", "utf8");
    writeFileSync(
      path.join(root, "node_modules", "pkg", "secret.ts"),
      "export const x = 1;\n",
      "utf8",
    );
    writeFileSync(path.join(root, "local.log"), "log\n", "utf8");
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("[CTX-03] caminho listado no .gitignore é omitido após canonicalização", () => {
  withWorkspace((root) => {
    const rules = buildContextExclusionRules({
      workspaceRoot: root,
      workspaceExclusionPatterns: [],
      projectIgnorePatterns: ["node_modules/", "*.log"],
    });
    assert.ok(!("valid" in rules));

    const excluded = evaluateContextPathExclusion({
      ruleset: rules,
      requestedPath: "node_modules/pkg/secret.ts",
    });
    assert.ok(!("error" in excluded));
    assert.equal(excluded.included, false);
    if (!excluded.included) {
      assert.equal(excluded.source, "project-ignore");
      assert.match(excluded.matchedPattern, /node_modules/);
    }

    const logFile = evaluateContextPathExclusion({
      ruleset: rules,
      requestedPath: path.join(root, "local.log"),
    });
    assert.ok(!("error" in logFile));
    assert.equal(logFile.included, false);

    const included = evaluateContextPathExclusion({
      ruleset: rules,
      requestedPath: "./src/../src/app.ts",
    });
    assert.ok(!("error" in included));
    assert.equal(included.included, true);
    if (included.included) {
      assert.ok(included.canonicalPath.endsWith(`${path.sep}src${path.sep}app.ts`));
    }
  }, "node_modules/\n*.log\n");
});

test("[CTX-03] padrões do workspace config também omitem caminhos", () => {
  withWorkspace((root) => {
    const rules = buildContextExclusionRules({
      workspaceRoot: root,
      workspaceExclusionPatterns: ["src/private/"],
      projectIgnorePatterns: [],
    });
    assert.ok(!("valid" in rules));

    mkdirSync(path.join(root, "src", "private"), { recursive: true });
    writeFileSync(path.join(root, "src", "private", "key.txt"), "secret\n", "utf8");

    const excluded = evaluateContextPathExclusion({
      ruleset: rules,
      requestedPath: "src/private/key.txt",
    });
    assert.ok(!("error" in excluded));
    assert.equal(excluded.included, false);
    if (!excluded.included) {
      assert.equal(excluded.source, "workspace-config");
    }
  });
});

test("[CTX-03] filterIncludedContextPaths remove excluídos para indexação/busca/contexto", () => {
  withWorkspace((root) => {
    const rules = buildContextExclusionRules({
      workspaceRoot: root,
      workspaceExclusionPatterns: [],
      projectIgnorePatterns: ["node_modules/"],
    });
    assert.ok(!("valid" in rules));

    const filtered = filterIncludedContextPaths(rules, [
      "src/app.ts",
      "node_modules/pkg/secret.ts",
    ]);
    assert.equal(filtered.length, 1);
    assert.ok(filtered[0]?.endsWith(`${path.sep}src${path.sep}app.ts`));
  });
});

test("[CTX-03] exclusions_json inválido retorna INVALID_STATE sem efeito colateral", () => {
  const parsed = parseWorkspaceExclusionPatterns({ bad: true });
  assert.equal(parsed.valid, false);
  if (!parsed.valid) {
    assert.equal(parsed.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
  }

  const rules = buildContextExclusionRules({
    workspaceRoot: "/tmp/ws",
    workspaceExclusionPatterns: [""],
  });
  assert.ok("valid" in rules && rules.valid === false);
});

test("[CTX-03] caminho fora do workspace retorna OUT_OF_SCOPE", () => {
  withWorkspace((root) => {
    const rules = buildContextExclusionRules({
      workspaceRoot: root,
      workspaceExclusionPatterns: [],
    });
    assert.ok(!("valid" in rules));

    const result = evaluateContextPathExclusion({
      ruleset: rules,
      requestedPath: "/etc/passwd",
    });
    assert.ok("error" in result);
    assert.equal(result.error.code, PROTOCOL_ERROR_CODES.OUT_OF_SCOPE);
  });
});
