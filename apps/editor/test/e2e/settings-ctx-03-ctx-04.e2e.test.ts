import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PROTOCOL_ERROR_CODES, ProtocolError } from "@openagent/protocol";
import {
  filterIncludedContextAttachmentDrafts,
  filterIncludedContextPaths,
  resolveContextExclusionRuleset,
} from "@openagent/context";
import {
  SettingsController,
  buildSettingsView,
  type IndexSizeSnapshot,
  type SettingsProviderPort,
} from "../../src/settings/index.js";

describe("Settings CTX-03/CTX-04 e2e — exclusões e limpeza do índice", () => {
  it("[CTX-03] exclui caminho de indexação, contexto automático e busca observavelmente", async () => {
    const rules = ["secrets/**"];
    const controller = new SettingsController({
      async testAndSaveProvider() { throw new Error("not used"); },
      async setExclusionPatterns(patterns) { rules.splice(0, rules.length, ...patterns); },
      async getExclusionPatterns() { return [...rules]; },
    });

    await controller.loadExclusionRules([".git/**"]);
    await controller.setExclusionPatterns(["secrets/**"]);
    const configured = controller.snapshot.exclusionRules
      .filter((rule) => rule.source === "workspace-config")
      .map((rule) => rule.pattern);
    assert.deepEqual(configured, ["secrets/**"]);

    const workspaceRoot = "/tmp/openagent-settings-ctx-153";
    const ruleset = resolveContextExclusionRuleset({
      workspaceRoot,
      workspaceExclusionPatterns: configured,
      projectIgnorePatterns: [".git/**"],
    });
    const indexablePaths = filterIncludedContextPaths(ruleset, [
      `${workspaceRoot}/secrets/token.txt`,
      `${workspaceRoot}/src/main.ts`,
    ]);
    assert.deepEqual(indexablePaths, [`${workspaceRoot}/src/main.ts`]);
    const automaticContext = filterIncludedContextAttachmentDrafts(ruleset, [
      { id: "secret", kind: "file", path: `${workspaceRoot}/secrets/token.txt`, previewText: "secret" },
      { id: "public", kind: "file", path: `${workspaceRoot}/src/main.ts`, previewText: "public" },
    ]);
    assert.deepEqual(automaticContext.map((attachment) => attachment.id), ["public"]);
    const searchablePaths = filterIncludedContextPaths(ruleset, [
      `${workspaceRoot}/secrets/token.txt`,
      `${workspaceRoot}/src/main.ts`,
    ]);
    assert.deepEqual(searchablePaths, [`${workspaceRoot}/src/main.ts`]);
    assert.match(buildSettingsView({
      endpoint: "", model: "", hasCredential: false, capabilities: null,
      secretRef: null, contextLimitTokens: null, errorMessage: null,
      exclusionRules: controller.snapshot.exclusionRules,
    }).html, /secrets\/\*\*/);
  });

  it("[CTX-04] exibe escopo e tamanho antes da confirmação e observa limpeza local", async () => {
    const before: IndexSizeSnapshot = { indexedFileCount: 3, chunkCount: 8, lexicalBytes: 2048 };
    let localIndex = { ...before };
    let cleared = false;
    const port: SettingsProviderPort = {
      async testAndSaveProvider() { throw new Error("not used"); },
      async setExclusionPatterns() {},
      async describeIndexSize() { return { ...localIndex }; },
      async confirmAndClearIndex() {
        cleared = true;
        localIndex = { indexedFileCount: 0, chunkCount: 0, lexicalBytes: 0 };
        return { cleared: true, scope: "workspace", size: { ...localIndex } };
      },
    };
    const controller = new SettingsController(port);
    await controller.describeIndexSize();
    const preview = buildSettingsView({
      endpoint: "", model: "", hasCredential: false, capabilities: null,
      secretRef: null, contextLimitTokens: null, errorMessage: null,
      indexSizeSnapshot: controller.snapshot.indexSizeSnapshot,
    });
    assert.match(preview.html, /Escopo: workspace atual/);
    assert.match(preview.html, /Arquivos: 3/);
    assert.match(preview.html, /Trechos: 8/);
    assert.match(preview.html, /2048 bytes/);
    assert.equal(cleared, false);

    await controller.clearIndex(true, before);
    assert.equal(cleared, true);
    assert.deepEqual(localIndex, { indexedFileCount: 0, chunkCount: 0, lexicalBytes: 0 });
    assert.deepEqual(controller.snapshot.indexSizeSnapshot, localIndex);
  });

  it("[CTX-03/04 erro] rejeita padrão inválido e confirmação/estado inválido sem efeitos", async () => {
    let writes = 0;
    let clears = 0;
    const port: SettingsProviderPort = {
      async testAndSaveProvider() { throw new Error("not used"); },
      async setExclusionPatterns() { writes += 1; },
      async describeIndexSize() { return { indexedFileCount: 2, chunkCount: 4, lexicalBytes: 100 }; },
      async confirmAndClearIndex() {
        clears += 1;
        return { cleared: true, scope: "workspace", size: { indexedFileCount: 0, chunkCount: 0, lexicalBytes: 0 } };
      },
    };
    const controller = new SettingsController(port);
    const rulesBefore = controller.snapshot.exclusionRules;
    await assert.rejects(
      controller.setExclusionPatterns(["  "]),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(writes, 0);
    assert.deepEqual(controller.snapshot.exclusionRules, rulesBefore);

    await assert.rejects(
      controller.clearIndex(true),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(clears, 0);
    await controller.describeIndexSize();
    await assert.rejects(
      controller.clearIndex(false),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(clears, 0);
    assert.deepEqual(controller.snapshot.indexSizeSnapshot, { indexedFileCount: 2, chunkCount: 4, lexicalBytes: 100 });
  });
});
