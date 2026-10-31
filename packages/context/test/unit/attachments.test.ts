import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContextSendPreview,
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  estimateContextTokens,
  parseContextAttachmentDrafts,
  resolveContextTokenLimit,
  resolveStoredWorkspaceContextLimit,
  validateContextAttachmentDraft,
  validateContextTokenLimitInput,
} from "../../src/index.js";

test("[CTX-01] buildContextSendPreview lista seleção, arquivo, pasta e símbolo com tokens e teto", () => {
  const attachments = [
    {
      id: "sel-1",
      kind: "selection",
      path: "/proj/src/a.ts",
      previewText: "function foo() {}",
    },
    {
      id: "file-1",
      kind: "file",
      path: "/proj/README.md",
      previewText: "# Readme\n",
    },
    {
      id: "folder-1",
      kind: "folder",
      path: "/proj/src",
    },
    {
      id: "sym-1",
      kind: "symbol",
      path: "/proj/src/a.ts",
      symbolName: "foo",
      previewText: "function foo() {}",
    },
  ] as const;

  const parsed = parseContextAttachmentDrafts(attachments);
  assert.equal(parsed.valid, true);
  if (!parsed.valid) {
    return;
  }

  const preview = buildContextSendPreview({
    attachments: parsed.value,
    contextLimitTokens: 500,
  });

  assert.equal(preview.sources.length, 4);
  assert.deepEqual(
    preview.sources.map((row) => row.kind),
    ["selection", "file", "folder", "symbol"],
  );
  assert.equal(preview.contextLimitTokens, 500);
  assert.ok(preview.totalTokenCount > 0);
  assert.equal(preview.sources[2]?.tokenCount, 0);
  assert.match(preview.sources[0]?.label ?? "", /seleção/);
  assert.match(preview.sources[3]?.label ?? "", /foo/);
  assert.equal(typeof preview.withinLimit, "boolean");
  assert.equal(preview.messageTokenCount, 0);
});

test("[API-03] buildContextSendPreview exibe teto 200000 sem valor gravado no workspace", () => {
  const preview = buildContextSendPreview({
    attachments: [],
    messageText: "Olá, agente",
    workspaceContextLimitTokens: null,
  });
  assert.equal(preview.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);
  assert.ok(preview.messageTokenCount > 0);
  assert.equal(preview.totalTokenCount, preview.messageTokenCount);
});

test("[API-03] buildContextSendPreview usa teto gravado no workspace quando configurado", () => {
  const preview = buildContextSendPreview({
    attachments: [],
    workspaceContextLimitTokens: 128_000,
  });
  assert.equal(preview.contextLimitTokens, 128_000);
});

test("[CTX-01] buildContextSendPreview soma tokens de anexos, mensagem e teto antes do envio", () => {
  const parsed = parseContextAttachmentDrafts([
    {
      id: "file-1",
      kind: "file",
      path: "/proj/a.ts",
      previewText: "abcd",
    },
  ]);
  assert.equal(parsed.valid, true);
  if (!parsed.valid) {
    return;
  }
  const preview = buildContextSendPreview({
    attachments: parsed.value,
    messageText: "pergunta",
    workspaceContextLimitTokens: null,
  });
  assert.equal(preview.sources.length, 1);
  assert.ok(preview.messageTokenCount > 0);
  const firstSource = preview.sources[0];
  assert.ok(firstSource);
  assert.equal(
    preview.totalTokenCount,
    firstSource.tokenCount + preview.messageTokenCount,
  );
  assert.equal(preview.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);
});

test("[CTX-01] resolveContextTokenLimit usa 200000 quando não configurado (API-03)", () => {
  assert.equal(resolveContextTokenLimit(undefined), DEFAULT_CONTEXT_TOKEN_LIMIT);
  assert.equal(resolveContextTokenLimit(8192), 8192);
  assert.equal(resolveStoredWorkspaceContextLimit(undefined), DEFAULT_CONTEXT_TOKEN_LIMIT);
  assert.equal(resolveStoredWorkspaceContextLimit(null), DEFAULT_CONTEXT_TOKEN_LIMIT);
});

test("[API-03] validateContextTokenLimitInput rejeita teto inválido com INVALID_STATE", () => {
  for (const bad of [0, -1, 1.5, "200000", null, {}]) {
    const result = validateContextTokenLimitInput(bad);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.code, "INVALID_STATE");
      assert.ok(result.errors.length > 0);
    }
  }
  const ok = validateContextTokenLimitInput(200_000);
  assert.equal(ok.valid, true);
  if (ok.valid) {
    assert.equal(ok.value, 200_000);
  }
});

test("[CTX-01] estimateContextTokens é conservadora e não-zero para texto não-vazio", () => {
  assert.equal(estimateContextTokens(""), 0);
  assert.equal(estimateContextTokens("abcd"), 1);
  assert.equal(estimateContextTokens("a".repeat(8)), 2);
});

test("[CTX-01] entrada inválida retorna INVALID_STATE sem efeito colateral", () => {
  const badKind = validateContextAttachmentDraft({
    id: "x",
    kind: "workspace",
    path: "/a",
  });
  assert.equal(badKind.valid, false);
  if (badKind.valid) {
    return;
  }
  assert.equal(badKind.code, "INVALID_STATE");
  assert.ok(badKind.errors.length > 0);

  const badSymbol = validateContextAttachmentDraft({
    id: "sym",
    kind: "symbol",
    path: "/a.ts",
  });
  assert.equal(badSymbol.valid, false);
  if (!badSymbol.valid) {
    assert.equal(badSymbol.code, "INVALID_STATE");
  }

  const badList = parseContextAttachmentDrafts({ not: "array" });
  assert.equal(badList.valid, false);
  if (!badList.valid) {
    assert.equal(badList.code, "INVALID_STATE");
  }
});
