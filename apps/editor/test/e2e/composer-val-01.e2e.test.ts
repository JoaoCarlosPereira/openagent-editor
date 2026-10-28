import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, USER_INPUT_EMPTY_MESSAGE } from "@openagent/protocol";

import { AgentPanelController } from "../../src/agent/agent-panel.js";

describe("VAL-01 e2e — Composer recusa mensagem vazia com o texto exato", () => {
  it("exibe a frase exata do PRD e não envia quando texto e anexo estão ausentes", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-val-01-empty",
      initialHistory: [{ id: "keep", role: "assistant", content: "Preservar" }],
    });
    panel.setComposerText("");

    assert.throws(
      () => panel.submitComposer(),
      (error: unknown) =>
        error instanceof ProtocolError &&
        error.code === "INVALID_STATE" &&
        error.message === USER_INPUT_EMPTY_MESSAGE,
    );

    assert.equal(
      panel.snapshot.accessible.composerValidationMessage,
      USER_INPUT_EMPTY_MESSAGE,
    );
    assert.match(
      panel.snapshot.html,
      /data-testid="agent-composer-validation"[^>]*>Escreva uma mensagem ou anexe um contexto\./,
    );
    assert.match(panel.snapshot.html, /aria-invalid="true"/);
    assert.equal(panel.snapshot.accessible.historyCount, 1);
    assert.match(panel.snapshot.html, /Preservar/);
  });

  it("caminho de erro: whitespace sem anexo retorna INVALID_STATE sem efeito colateral", () => {
    const panel = new AgentPanelController();
    panel.open({
      sessionId: "sess-val-01-ws",
      initialHistory: [{ id: "h1", role: "user", content: "Anterior" }],
    });
    panel.setComposerText(" \n\t  ");
    const beforeHtml = panel.snapshot.html;

    assert.throws(
      () => panel.submitComposer(),
      (error: unknown) =>
        error instanceof ProtocolError && error.code === "INVALID_STATE",
    );

    assert.equal(panel.snapshot.accessible.historyCount, 1);
    assert.equal(panel.snapshot.accessible.composerText, " \n\t  ");
    assert.equal(
      panel.snapshot.accessible.composerValidationMessage,
      USER_INPUT_EMPTY_MESSAGE,
    );
    assert.match(beforeHtml, /Anterior/);
    assert.match(panel.snapshot.html, /Anterior/);
  });

  it("aceita envio só com anexo (sem texto) e limpa a validação", () => {
    const panel = new AgentPanelController();
    panel.open({ sessionId: "sess-val-01-attach" });
    panel.setComposerText("   ");
    panel.setContextAttachments([{ ref: "ctx://file.ts", label: "file.ts" }]);

    const result = panel.submitComposer();

    assert.equal(result.userInput.text, "   ");
    assert.deepEqual(result.userInput.attachments, [{ ref: "ctx://file.ts" }]);
    assert.equal(result.history.length, 1);
    assert.equal(result.view.accessible.composerValidationMessage, null);
    assert.doesNotMatch(result.view.html, /data-testid="agent-composer-validation"/);
  });
});
