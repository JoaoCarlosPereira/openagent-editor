import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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

    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "openagent-settings-ctx-153-"));
    try {
      mkdirSync(path.join(workspaceRoot, "secrets"), { recursive: true });
      mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      writeFileSync(path.join(workspaceRoot, "secrets", "token.txt"), "secret", "utf8");
      writeFileSync(path.join(workspaceRoot, "src", "main.ts"), "public", "utf8");
      const ruleset = resolveContextExclusionRuleset({
        workspaceRoot,
        workspaceExclusionPatterns: configured,
        projectIgnorePatterns: [".git/**"],
      });
      const secretPath = path.join(workspaceRoot, "secrets", "token.txt");
      const publicPath = path.join(workspaceRoot, "src", "main.ts");
      const indexablePaths = filterIncludedContextPaths(ruleset, [secretPath, publicPath]);
      assert.deepEqual(indexablePaths, [publicPath]);
      const automaticContext = filterIncludedContextAttachmentDrafts(ruleset, [
        { id: "secret", kind: "file", path: secretPath, previewText: "secret" },
        { id: "public", kind: "file", path: publicPath, previewText: "public" },
      ]);
      assert.deepEqual(automaticContext.map((attachment) => attachment.id), ["public"]);
      const searchablePaths = filterIncludedContextPaths(ruleset, [secretPath, publicPath]);
      assert.deepEqual(searchablePaths, [publicPath]);
      assert.match(buildSettingsView({
        endpoint: "", model: "", hasCredential: false, capabilities: null,
        secretRef: null, contextLimitTokens: null, errorMessage: null,
        exclusionRules: controller.snapshot.exclusionRules,
      }).html, /secrets\/\*\*/);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
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

    const withoutConfirmation = buildSettingsView({
      endpoint: "", model: "", hasCredential: false, capabilities: null,
      secretRef: null, contextLimitTokens: null, errorMessage: null,
      indexSizeSnapshot: controller.snapshot.indexSizeSnapshot,
      clearConfirmationChecked: false,
    });
    assert.match(withoutConfirmation.html, /data-testid="clear-index"[^>]* disabled/);
    assert.doesNotMatch(withoutConfirmation.html, /data-testid="confirm-clear-index" checked/);
    const withConfirmation = buildSettingsView({
      endpoint: "", model: "", hasCredential: false, capabilities: null,
      secretRef: null, contextLimitTokens: null, errorMessage: null,
      indexSizeSnapshot: controller.snapshot.indexSizeSnapshot,
      clearConfirmationChecked: true,
    });
    assert.match(withConfirmation.html, /data-testid="confirm-clear-index" checked/);
    assert.doesNotMatch(withConfirmation.html, /data-testid="clear-index"[^>]* disabled/);

    await controller.clearIndex(true, before);
    assert.equal(cleared, true);
    assert.deepEqual(localIndex, { indexedFileCount: 0, chunkCount: 0, lexicalBytes: 0 });
    assert.deepEqual(controller.snapshot.indexSizeSnapshot, localIndex);
  });

  it("[CTX-04] valida tamanho inteiro seguro/não-negativo e coerência do resultado da limpeza", async () => {
    const invalidSizes: Array<Partial<IndexSizeSnapshot> | null> = [
      null,
      { indexedFileCount: -1, chunkCount: 0, lexicalBytes: 0 },
      { indexedFileCount: 0, chunkCount: 0.5, lexicalBytes: 0 },
      { indexedFileCount: 0, chunkCount: 0, lexicalBytes: Number.MAX_SAFE_INTEGER + 2 },
    ];
    for (const invalidSize of invalidSizes) {
      const controller = new SettingsController({
        async testAndSaveProvider() { throw new Error("not used"); },
        async describeIndexSize() { return (invalidSize ?? {}) as IndexSizeSnapshot; },
        async confirmAndClearIndex() { return { cleared: true, scope: "workspace", size: invalidSize as IndexSizeSnapshot }; },
      });
      await assert.rejects(
        controller.describeIndexSize(),
        (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
      );
      assert.equal(controller.snapshot.indexSizeSnapshot, null);
    }

    let clears = 0;
    const controller = new SettingsController({
      async testAndSaveProvider() { throw new Error("not used"); },
      async describeIndexSize() { return { indexedFileCount: 1, chunkCount: 2, lexicalBytes: 3 }; },
      async confirmAndClearIndex() {
        clears += 1;
        return { cleared: true, scope: "workspace", size: { indexedFileCount: 0, chunkCount: 1, lexicalBytes: 0 } };
      },
    });
    await controller.describeIndexSize();
    await assert.rejects(
      controller.clearIndex(true),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(clears, 1);
    assert.deepEqual(controller.snapshot.indexSizeSnapshot, { indexedFileCount: 1, chunkCount: 2, lexicalBytes: 3 });

    await assert.rejects(
      controller.clearIndex(true, { indexedFileCount: -1, chunkCount: 2, lexicalBytes: 3 }),
      (error: unknown) => error instanceof ProtocolError && error.code === PROTOCOL_ERROR_CODES.INVALID_STATE,
    );
    assert.equal(clears, 1);
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
