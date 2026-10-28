import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CONTEXT_TOKEN_LIMIT } from "@openagent/context";
import { ProtocolError } from "@openagent/protocol";

import { AgentPanelController } from "../../src/agent/agent-panel.js";

describe("CTX-01 / API-03 e2e — Prévia de fontes, tokens e teto antes do envio", () => {
  it("[CTX-01] lista seleção, arquivo, pasta e símbolo com tokens e teto antes do envio", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-ctx-01-sources" });
    panel.setComposerText("Revise o anexo");
    panel.setContextAttachments([
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
    ]);

    const preview = panel.snapshot.accessible.contextPreview;
    assert.equal(preview.sourceCount, 4);
    assert.equal(preview.sourceLabels.length, 4);
    assert.match(preview.sourceLabels[0] ?? "", /seleção/);
    assert.match(preview.sourceLabels[3] ?? "", /foo/);
    assert.ok(preview.totalTokenCount > 0);
    assert.ok(preview.messageTokenCount > 0);
    assert.equal(preview.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);

    assert.match(panel.snapshot.html, /data-testid="context-send-preview"/);
    assert.match(panel.snapshot.html, /data-testid="context-source-list"/);
    assert.match(panel.snapshot.html, /data-kind="selection"/);
    assert.match(panel.snapshot.html, /data-kind="file"/);
    assert.match(panel.snapshot.html, /data-kind="folder"/);
    assert.match(panel.snapshot.html, /data-kind="symbol"/);
    assert.match(panel.snapshot.html, /data-testid="context-source-tokens"/);
    assert.match(
      panel.snapshot.html,
      new RegExp(`data-testid="context-token-limit"[^>]*>Teto: ${DEFAULT_CONTEXT_TOKEN_LIMIT}`),
    );
  });

  it("[API-03] exibe teto 200000 quando o workspace não gravou outro valor", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-api-03-default",
      workspaceContextLimitTokens: null,
    });
    panel.setComposerText("Pronto para enviar");

    const preview = panel.snapshot.accessible.contextPreview;
    assert.equal(preview.contextLimitTokens, 200_000);
    assert.equal(preview.contextLimitTokens, DEFAULT_CONTEXT_TOKEN_LIMIT);
    assert.ok(preview.messageTokenCount > 0);
    assert.match(
      panel.snapshot.html,
      /data-testid="context-token-limit"[^>]*>Teto: 200000 tokens/,
    );
  });

  it("[API-03] usa teto gravado no workspace quando configurado", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-api-03-custom",
      workspaceContextLimitTokens: 12_000,
    });
    panel.setComposerText("oi");

    assert.equal(panel.snapshot.accessible.contextPreview.contextLimitTokens, 12_000);
    assert.match(
      panel.snapshot.html,
      /data-testid="context-token-limit"[^>]*>Teto: 12000 tokens/,
    );
  });

  it("[CTX-01] caminho de erro: anexo inválido retorna INVALID_STATE sem efeito colateral", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-ctx-01-err" });
    panel.setContextAttachments([
      {
        id: "keep-1",
        kind: "file",
        path: "/proj/keep.ts",
        previewText: "const keep = 1;",
      },
    ]);
    const before = panel.snapshot.accessible.contextPreview;
    assert.equal(before.sourceCount, 1);

    assert.throws(
      () =>
        panel.setContextAttachments([
          { id: "bad", kind: "not-a-kind", path: "/x" },
        ]),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    const after = panel.snapshot.accessible.contextPreview;
    assert.equal(after.sourceCount, 1);
    assert.deepEqual(after.sourceLabels, before.sourceLabels);
    assert.match(panel.snapshot.html, /keep\.ts/);
  });
});
