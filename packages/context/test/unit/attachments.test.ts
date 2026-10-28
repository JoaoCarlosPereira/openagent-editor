import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContextSendPreview,
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  estimateContextTokens,
  parseContextAttachmentDrafts,
  resolveContextTokenLimit,
  validateContextAttachmentDraft,
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
});

test("[CTX-01] resolveContextTokenLimit usa 200000 quando não configurado (API-03)", () => {
  assert.equal(resolveContextTokenLimit(undefined), DEFAULT_CONTEXT_TOKEN_LIMIT);
  assert.equal(resolveContextTokenLimit(8192), 8192);
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
