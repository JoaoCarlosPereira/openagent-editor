import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTOCOL_ERROR_CODES,
  ProtocolError,
} from "@openagent/protocol";

import {
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  executeContextAttachRpc,
} from "../../src/index.js";

const SAMPLE_ATTACHMENTS = [
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

test("[CTX-01] executeContextAttachRpc lista fontes, tokens e teto antes do envio", () => {
  const result = executeContextAttachRpc(
    {
      attachments: [...SAMPLE_ATTACHMENTS],
      messageText: "pergunta",
    },
    { workspaceContextLimitTokens: 128_000 },
  );

  assert.equal(result.sources.length, 4);
  assert.deepEqual(
    result.sources.map((row) => row.kind),
    ["selection", "file", "folder", "symbol"],
  );
  assert.equal(result.contextLimitTokens, 128_000);
  assert.ok(result.messageTokenCount > 0);
  assert.ok(result.totalTokenCount > result.messageTokenCount);
  assert.equal(result.sources[2]?.tokenCount, 0);
  assert.equal(typeof result.withinLimit, "boolean");
});

test("[CTX-01] executeContextAttachRpc usa teto padrão API-03 sem workspace persistido", () => {
  const result = executeContextAttachRpc({
    attachments: [
      {
        id: "file-1",
        kind: "file",
        path: "/proj/a.ts",
        previewText: "x",
      },
    ],
  });

  assert.equal(result.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);
});

test("[CTX-01] executeContextAttachRpc rejeita entrada inválida com INVALID_STATE", () => {
  assert.throws(
    () =>
      executeContextAttachRpc({
        attachments: [
          {
            id: "bad",
            kind: "workspace",
            path: "/a",
          },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );

  assert.throws(
    () =>
      executeContextAttachRpc({
        attachments: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProtocolError);
      assert.equal(error.code, PROTOCOL_ERROR_CODES.INVALID_STATE);
      return true;
    },
  );
});
